import { useUi } from '../store';
import { VoiceClient, type VoiceDeps } from './voiceClient';

let client: VoiceClient | null = null;

/** The one voice session, wired to the store (voice and typed turns share the chat). */
export function getVoice(deps?: VoiceDeps): VoiceClient {
  if (client) return client;
  const ui = () => useUi.getState();
  client = new VoiceClient(
    {
      status: (s) => ui().setVoice({ status: s, ...(s === 'off' ? { partial: '' } : {}), ...(s !== 'error' ? { error: null } : {}) }),
      partial: (text) => ui().setVoice({ partial: text }),
      final: (text) => {
        ui().voiceUserTurn(text);
        if (ui().tab !== 'chat' || ui().overlay) ui().setTab('chat');
      },
      delta: (text) => ui().voiceDelta(text),
      done: (text) => ui().voiceDone(text),
      interrupted: (spoken) => ui().voiceInterrupted(spoken),
      error: (message) => ui().setVoice({ error: message }),
    },
    deps,
  );
  return client;
}

export function toggleVoice(): void {
  const v = getVoice();
  if (v.active) v.stop();
  else void v.start();
}
