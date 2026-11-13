/**
 * Module registry: routes, WebSocket upgrades, executor overrides and event
 * dispatch. Event hooks run in the background, outside any approval scope,
 * and are tracked so tests can wait for them with `idle()`.
 */
import type { SuggestionKind } from '@poc/contracts';
import { outsideApproval } from '../guard';
import type { BrainModule, Executor, HttpMethod, RouteHandler, UpgradeHandler } from './types';

type HookName = 'onMessageTriaged' | 'onSuggestionApplied' | 'onSuggestionDenied' | 'onSuggestionFailed' | 'onTasksChanged' | 'onCalendarChanged' | 'onTick';
type HookArg<H extends HookName> = Parameters<NonNullable<BrainModule[H]>>[0];

interface Route {
  method: HttpMethod;
  pattern: string;
  parts: string[];
  handler: RouteHandler;
  owner: string;
}

export class Registry {
  readonly modules: BrainModule[] = [];
  private routes: Route[] = [];
  private upgrades = new Map<string, { handler: UpgradeHandler; owner: string }>();
  private overrides = new Map<SuggestionKind, { executor: Executor; owner: string }>();
  private pending = new Set<Promise<unknown>>();

  constructor(private log: (msg: string, extra?: unknown) => void) {}

  addRoute(owner: string, method: HttpMethod, pattern: string, handler: RouteHandler): void {
    if (!pattern.startsWith('/')) throw new Error(`route pattern must start with /: ${pattern}`);
    const parts = pattern.split('/').filter(Boolean);
    const clash = this.routes.find((r) => r.method === method && r.parts.length === parts.length && r.parts.every((p, i) => p === parts[i] || (p.startsWith(':') && parts[i]!.startsWith(':'))));
    if (clash) throw new Error(`route ${method} ${pattern} (${owner}) clashes with ${clash.pattern} (${clash.owner})`);
    this.routes.push({ method, pattern, parts, handler, owner });
  }

  /** Find a route; `methodMismatch` is true when the path exists for another method. */
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | { methodMismatch: boolean } {
    const segs = pathname.split('/').filter(Boolean);
    let pathExists = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i]!;
        if (p.startsWith(':')) {
          try {
            params[p.slice(1)] = decodeURIComponent(segs[i]!);
          } catch {
            ok = false;
            break;
          }
        } else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathExists = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return { methodMismatch: pathExists };
  }

  addUpgrade(owner: string, path: string, handler: UpgradeHandler): void {
    const existing = this.upgrades.get(path);
    if (existing) throw new Error(`upgrade ${path} (${owner}) is already registered by ${existing.owner}`);
    this.upgrades.set(path, { handler, owner });
  }

  upgradeFor(path: string): UpgradeHandler | null {
    return this.upgrades.get(path)?.handler ?? null;
  }

  overrideExecutor(owner: string, kind: SuggestionKind, executor: Executor): void {
    const existing = this.overrides.get(kind);
    if (existing) throw new Error(`executor for ${kind} (${owner}) is already overridden by ${existing.owner}`);
    this.overrides.set(kind, { executor, owner });
  }

  executorOverride(kind: SuggestionKind): Executor | null {
    return this.overrides.get(kind)?.executor ?? null;
  }

  /** Call `hook` on every module that has it, in the background. */
  emit<H extends HookName>(hook: H, arg: HookArg<H>): void {
    for (const m of this.modules) {
      const fn = m[hook] as ((a: HookArg<H>) => void | Promise<void>) | undefined;
      if (!fn) continue;
      const p = outsideApproval(() =>
        Promise.resolve()
          .then(() => fn.call(m, arg))
          .catch((err) => this.log(`module ${m.name} ${hook} failed: ${(err as Error).message}`)),
      );
      this.track(p);
    }
  }

  /** Track background work started elsewhere (e.g. a state push). */
  track(p: Promise<unknown>): void {
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  /** Resolves when all background hook work (including work it started) is done. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
