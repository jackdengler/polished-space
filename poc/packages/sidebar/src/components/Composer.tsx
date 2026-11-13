import { useRef, useState, type KeyboardEvent } from 'react';
import { useUi, type VoiceStatus } from '../store';
import { toggleVoice } from '../voice/useVoice';
import { Icon } from './Icon';

const VOICE_LABEL: Record<VoiceStatus, string> = {
  off: '',
  connecting: 'Starting the microphone…',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking: talk over me to interrupt',
  error: 'Voice is off',
};

export function Composer() {
  const [text, setText] = useState('');
  const sendChat = useUi((s) => s.sendChat);
  const busy = useUi((s) => s.chatBusy);
  const voice = useUi((s) => s.voice);
  const offline = useUi((s) => s.connection === 'lost');
  const ref = useRef<HTMLTextAreaElement>(null);
  const voiceOn = voice.status !== 'off' && voice.status !== 'error';
  const showPartial = voiceOn && voice.partial && !text;

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    void sendChat(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const rows = Math.min(4, Math.max(1, text.split('\n').length));

  return (
    <div className={`composer voice-${voice.status}`}>
      {voice.status !== 'off' ? (
        <div className="voice-strip" role="status" aria-live="polite">
          <span className={`voice-dot ${voice.status}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="voice-label">{voice.status === 'error' && voice.error ? voice.error : VOICE_LABEL[voice.status]}</span>
        </div>
      ) : null}
      <form
        className="composer-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="composer-box">
          <label htmlFor="composer-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="composer-input"
            ref={ref}
            className="composer-input"
            rows={rows}
            placeholder={showPartial ? '' : voiceOn ? 'Speak, or type here…' : 'Ask, or add a task: “chase Michael on Friday”'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-describedby={showPartial ? 'composer-partial' : undefined}
          />
          {showPartial ? (
            <div id="composer-partial" className="composer-partial" aria-live="polite">
              {voice.partial}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`mic-btn${voiceOn ? ' on' : ''}`}
          onClick={() => toggleVoice()}
          aria-pressed={voiceOn}
          aria-label={voiceOn ? 'Stop voice' : 'Talk to the assistant'}
          title={voiceOn ? 'Stop voice' : 'Talk'}
          disabled={offline && !voiceOn}
        >
          <Icon name={voiceOn ? 'stop' : 'mic'} size={17} />
        </button>
        <button type="submit" className="send-btn" disabled={!text.trim() || busy || offline} aria-label="Send" title="Send (Enter)">
          <Icon name="send" size={17} />
        </button>
      </form>
    </div>
  );
}
