# FlipThis

A 3–20-player beat battle prototype for COGS 123. Everyone flips the same original vocal chop with a unique compatible sound pack, votes blind, then remixes another player's beat (Flip Back) and decides whether to form a crew.

**Stack:** Next.js 15 (App Router, TypeScript) · Tone.js for audio · server-authorized Firestore lobbies online · browser storage for local practice. Deployment preparation: [DEPLOYMENT.md](DEPLOYMENT.md).

## How a session runs

Choose **Create a lobby**, enter a lobby name and your name, and share the six-character room code or invite link. Classmates choose **Join a lobby**, enter their names, and receive free seats automatically (up to twenty). Your browser saves private host/player access so refreshes and returning visits keep your spot and work. Only the host can control phases, reset the battle, fill demo seats, or remove players.

Without online credentials, the same lobby flow runs as local practice between tabs in this browser. The **Classic single-device demo** section preserves HOST and PLAYER1–PLAYER20 seat codes. For online account setup and deployment, follow [DEPLOYMENT.md](DEPLOYMENT.md).

There are **20 distinct complementary packs**: the original Cloud, Keys, Strings, and Synth banks plus 16 synthesized packs. Every pack contains chords, melody, bass, and FX. All fit the shared 130 BPM / B minor progression. Each new battle shuffles the packs across all twenty seats without replacement, so personal loop files are never shared between players in that battle. Returning seats also receive a different pack from the preceding battle. Assignment is saved in the room; refreshing or rejoining keeps the same pack and beat. Legacy seat codes remain aliases; existing battles retain their original sounds until you start a new battle.

All players share one battle sample with original, reversed, and lo-fi versions and can pick any of 8 drum kits: Boom-bap, Trap, Lo-fi, House, Techno, Breakbeat, Garage, and Synthwave. The four new kits contain original synthesized kick, snare, hat, and clap WAVs; regenerate them with `npm run generate-drums`. Each kit has a preset rhythm available via **Kit groove**.

Taste Drop accepts two custom vibe tags. Even-sized rooms are paired automatically to maximize shared tags, ignoring case, repeated whitespace, and leading # signs. Ties use seat order; unrelated tags still produce a match. The host can see matches but cannot select them. Matches lock when Flip Back begins. Odd-sized rooms form one taste-matched remix circle of three plus pairs, so everyone gives and receives a flip; a trio forms a crew only if all three agree.

For song previews, enter an artist/title, choose **Find song preview**, and select the correct recording. A Next.js route searches Apple's public catalog and attaches an official Apple Music player to the taste wall. Alternatively attach a YouTube video or Apple Music song URL. Players open previews explicitly; nothing autoplays. Previews require internet, have provider/region availability limits, and offer an external link if embedding fails. Apple Music offers preview clips for listeners without a subscription. Song sharing, beat building, and local room sync still work when lookup is unavailable. No API keys or deployment are needed.

Phases (the host presses **Next** to move everyone): Lobby → Taste Drop → Flip → Vote → Reveal → Flip Back → Team Up → Crews.

The arrangement is **16 bars**, with independently editable loop placements and drum toggles in every bar. Scroll horizontally to reach all bars on smaller screens. Every source loop is **8 bars at 130 BPM in B minor** and follows the same progression (Bm · Bm · F#m7 · A · Bm · Bm · F# · A), so any loop from any bank fits with any other. Arrangement bars 1–8 use source bars 1–8; bars 9–16 use source bars 1–8 again. The drum sequencer supports 8 or 16 steps per bar, repeated in each enabled bar. Expanding preserves hits on their existing timing; reducing removes the finer in-between hits. Compact loop codes match the sound cards; the sample legend identifies each variation, and tapping a placed block shows its full name.

For rehearsals, choose a **Demo room size** between 3 and 20 (default 4), then fill to that size. Demo seats submit a beat, vote, leave clearly labeled demo feedback, flip, and say yes to teaming up automatically. All 20 demo seats have distinct emotional vibe tags; their song previews use a small catalog of four different artists.

## Fresh sounds for each battle

Use **New battle / reset** in the host panel to clear the finished round and reshuffle each participant’s unique complementary pack. Every new battle uses the original Vocal Chop, with its reverse and lo-fi variants. Reloading resumes the saved battle. Older saved battles retain their sample until reset.

The new library contains 85 original synthesized eight-bar WAV files: 64 personal loops and 21 shared sample variants. Regenerate these and their waveform previews with `npm run generate-loops`. Generation is offline and deterministic; all generated loops use 22.05 kHz mono PCM, the project tempo, and the existing chord progression. Reverse variants reverse within each bar to keep harmonic changes aligned. The original source loops are retained. Only the current battle’s sample variants and a player’s own pack are loaded for editing; imported partner sounds also load during remixing.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # packs, matching, drum assets, previews, API fallback, local sync
npm run typecheck
```

Without the three server-only Firebase credentials, named lobbies run in **local practice mode**. Open the host invite in additional tabs in the same browser. Existing classic demo rooms remain unchanged.

## Go online without enabling billing

Use a Firebase **Spark** project and a personal Vercel **Hobby** account. Online mutations go through the Next.js API; browser Firestore access is denied. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for account creation, private credential setup, real Firebase verification, Git-based deployment and a cross-device rehearsal. No online deployment has been configured by the code itself.

## Swapping in your own loops

All loop files live in `public/audio/loops/` and are listed in `lib/config.ts`. To use your own:

1. Put the originals in `loops-src/` and describe them in `loops-src/manifest.json` (`file`, target `id`, source `bpm`, `semitones` to shift into B minor).
2. `npm run prepare-loops` (needs ffmpeg with the rubberband filter). This time-stretches and pitch-shifts each file to exactly 8 bars at 130 BPM.
3. If you add or rename loops, update `BANKS` / `BATTLE_SAMPLES` in `lib/config.ts` (generated pack metadata is in `lib/soundCatalog.json`).

Credits: the Greentea pad and the vocal chop are Looperman loops (converted to 130 BPM / B minor). All other loops and drum sounds were synthesized for this project.

## Tweaks

- Phase lengths and minimum sample bars: `lib/config.ts`
- Seat codes and capacity: `SLOTS` in `lib/config.ts`
- Look and feel: `app/globals.css`

Flip Back allows unlimited edits until the player presses Done (and can be reopened with Keep editing). Voting shows a green confirmation with a brief shake and waits at least 750 ms, plus successful saving, before advancing. Reduced-motion preferences disable the shake.

## Voting and feedback

Voting freezes submitted beats that meet the shared-sample requirement. At least three eligible submissions are needed. Players who miss this cutoff observe voting and can still join the remix. Only eligible submitters judge this round; late joins do not change the schedule.

| Eligible submissions | Matchups per person | Scheduled judgments per beat |
|---|---:|---:|
| 3 | 1 | 2 |
| 4 | 3 | 6 |
| 5–20 | 6 | 12 |

Each cyclic round gives every beat one A-side and one B-side appearance, excludes self-voting, and avoids repeat matchups for a voter. Offset selection spreads opponents and listeners. At 20 submissions, each beat faces twelve different opponents. Rankings use win percentage among completed assigned votes, with shared ranks for ties; the UI shows completed versus assigned reviews so incomplete voting is visible. This is a short-session sample of preferences, not an exhaustive tournament. The host leaderboard stays hidden during blind voting.

Voters can write an optional, kind, specific note under either beat (280 characters). Notes save alongside the A/B choice, including feedback for the beat that was not selected. Reviewing a beat again lets a voter update their single note to that creator. Creators see the reviewer’s name and note only from Reveal onward in the “What people heard in your beat” panel, which stays available through Crews. As with the existing prototype, blind identities and feedback visibility are enforced by the interface; room snapshots are readable only by authenticated room members; blind comparison labels are still a presentation convention.

## Room chat

The global room chat is available to players and the facilitator in the Lobby and from Reveal through Crews. It pauses during Taste Drop, creation, and blind voting. The same conversation resumes after voting, with author names, phase labels, conversation-starter prompts, Enter-to-send, and Shift+Enter for line breaks. Reading older messages does not force a jump to the latest message.

Messages persist across refreshes in the current room, and **New battle / reset** clears them. Each message is limited to 400 characters; the latest 150 are kept. Bots do not send chat messages. Local writes use Web Locks in supporting browsers to serialize chat and beat updates; online Firestore mutations use server transactions. Sends check the latest phase and battle ID so a delayed message cannot leak into a later battle. Local mode still shares chat only among tabs in the same browser/origin. Online role and phase permissions are enforced by the server; private access-token digests never enter room snapshots. Classic demo mode remains a trusted single-device rehearsal.

## Verification

`npm test` covers existing game/audio behavior plus the real HTTP lobby handlers using an isolated repository. `npm run test:browser` exercises fresh browser profiles; `npm run test:firebase` is an explicit credentialed cloud check. See [DEPLOYMENT.md](DEPLOYMENT.md) for what each verifies.
