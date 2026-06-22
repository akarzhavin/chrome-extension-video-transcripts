import {AbsoluteFill, Sequence} from 'remotion';
import {Background} from './components/Background';
import {Intro} from './components/Intro';
import {ShotScene} from './components/ShotScene';
import {Cta} from './components/Cta';

// Scene lengths (frames @ 30fps). Scenes overlap by OVERLAP for soft crossfades.
const OVERLAP = 12;
const INTRO = 90; // 3.0s
const DUAL = 140; // ~4.7s
const GUESS = 140; // ~4.7s
const CTA = 96; // 3.2s

const introStart = 0;
const dualStart = introStart + INTRO - OVERLAP;
const guessStart = dualStart + DUAL - OVERLAP;
const ctaStart = guessStart + GUESS - OVERLAP;

export const PROMO_DURATION = ctaStart + CTA; // 430 frames ≈ 14.3s

export const Promo = () => {
  return (
    <AbsoluteFill>
      <Background />

      <Sequence from={introStart} durationInFrames={INTRO}>
        <Intro durationInFrames={INTRO} />
      </Sequence>

      <Sequence from={dualStart} durationInFrames={DUAL}>
        <ShotScene
          src="shot-dual.png"
          kicker="DUAL SUBTITLES"
          title={'Two languages,\nside by side'}
          durationInFrames={DUAL}
        />
      </Sequence>

      <Sequence from={guessStart} durationInFrames={GUESS}>
        <ShotScene
          src="shot-guess.png"
          kicker="GUESS MODE"
          title={'Hide one language,\ntest your listening'}
          durationInFrames={GUESS}
        />
      </Sequence>

      <Sequence from={ctaStart} durationInFrames={CTA}>
        <Cta durationInFrames={CTA} />
      </Sequence>
    </AbsoluteFill>
  );
};
