import { PHASES, PHASE_LABELS, type Phase } from '@/lib/config';

const instructions: Record<Phase, string> = {
  lobby: 'Wait for everyone; read how the battle works and listen to your sounds.',
  taste: 'Paste a Spotify link to one song, check the two vibe tags, drop it on the wall, and play others’ picks while waiting.',
  sample: 'Listen to the shared battle sample, then ready up. The host starts Flip when everyone is ready.',
  studio: 'Click grid boxes to place sounds, build a drum loop, press Space to listen, then Submit.',
  vote: 'Listen to two anonymous beats, pick one, and optionally leave a kind, specific note.',
  reveal: 'See the results and read everyone’s comments on the submissions.',
  flipback: 'Remix your matched partner’s beat; press Done when ready.',
  teamup: 'Hear the remix of your beat and decide whether to form a crew.',
  done: 'Meet the crews, chat with your collaborators, and share your feedback.',
};
export function PhaseInstructions({ phase }: { phase: Phase }) {
  return <aside className="banner phase-help" aria-label="What to do now"><strong>{PHASES.indexOf(phase) + 1}/{PHASES.length} · {PHASE_LABELS[phase]}</strong><span>{instructions[phase]}</span></aside>;
}
export function BattleInstructions() {
  const cards = [
    ['Taste Drop', 'Share a favorite song and two editable vibe tags.'],
    ['Flip', 'Use the shared sample, your sounds, and drums to finish a beat.'],
    ['Vote', 'Listen blind, choose a beat, and leave a kind, specific note.'],
    ['Reveal', 'See the creators, results, and everyone’s feedback.'],
    ['Flip Back', 'Remix a matched collaborator’s beat with unlimited edits.'],
    ['Team Up', 'Listen to the remixes and mutually choose whether to form a crew.'],
  ];
  return <section className="panel"><h2>How a battle works</h2><ol className="battle-howto">{cards.map(([title, text]) => <li className="card stack" key={title}><strong>{title}</strong><span className="hint">{text}</span></li>)}</ol><p className="hint">The host moves everyone to the next step. After Taste Drop, listen to the battle sample and ready up before Flip.</p></section>;
}
