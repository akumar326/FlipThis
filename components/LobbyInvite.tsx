'use client';
import { useEffect, useState } from 'react';
import { invitePath, type Session } from '@/lib/session';
import type { RoomState } from '@/lib/types';

export function LobbyInvite({ room, transport }: { room: RoomState; transport: Session['transport'] }) {
  const [link, setLink] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => {
    if (room.lobby) setLink(`${window.location.origin}${invitePath(room.lobby.code, transport)}`);
  }, [room.lobby?.code, transport]);
  if (!room.lobby) return null;
  return <section className="panel stack">
    <div className="panel-head"><h2>{room.lobby.name}</h2><div className="host-room-code"><span>Room code</span><strong>{room.lobby.code}</strong></div></div>
    <p className="hint">{transport === 'online' ? 'Share this invite with classmates. They choose a name and receive a seat automatically.' : 'Open this invite in another tab in this browser to practice with multiple players.'}</p>
    <div className="row"><input aria-label="Lobby invite link" className="input grow" readOnly value={link} onFocus={e => e.target.select()} />
      <button type="button" className="btn btn-primary" disabled={!link} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied!' : 'Copy invite'}</button></div>
    <span className="hint" role="status">{copied ? 'Invite copied. Your host access stays private in this browser.' : 'You can also select and copy the invite link above.'}</span>
  </section>;
}
