import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS, FONT} from '../theme';

export const Intro = ({durationInFrames}: {durationInFrames: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame, fps, config: {damping: 13, mass: 0.8}});
  const logoScale = interpolate(enter, [0, 1], [0.55, 1]);
  const glow = 18 + (0.5 + 0.5 * Math.sin(frame / 7)) * 34;

  const titleSpring = spring({frame: frame - 8, fps, config: {damping: 16}});
  const titleY = interpolate(titleSpring, [0, 1], [34, 0]);
  const titleOpacity = interpolate(frame, [8, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subOpacity = interpolate(frame, [20, 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames],
    [1, 0],
    {extrapolateLeft: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT,
      }}
    >
      <Img
        src={staticFile('logo.png')}
        style={{
          width: 190,
          height: 190,
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 ${glow}px ${COLORS.cyan}) drop-shadow(0 0 ${glow * 2}px ${COLORS.cyan}55)`,
        }}
      />
      <div
        style={{
          marginTop: 44,
          fontSize: 76,
          fontWeight: 800,
          letterSpacing: -1.5,
          color: COLORS.white,
          transform: `translateY(${titleY}px)`,
          opacity: titleOpacity,
        }}
      >
        Learn languages on YouTube
      </div>
      <div
        style={{
          marginTop: 22,
          fontSize: 30,
          fontWeight: 500,
          color: COLORS.muted,
          opacity: subOpacity,
        }}
      >
        Dual subtitles
        <span style={{color: COLORS.cyan, margin: '0 14px'}}>·</span>
        Interactive transcript
        <span style={{color: COLORS.cyan, margin: '0 14px'}}>·</span>
        One-click word saving
      </div>
    </AbsoluteFill>
  );
};
