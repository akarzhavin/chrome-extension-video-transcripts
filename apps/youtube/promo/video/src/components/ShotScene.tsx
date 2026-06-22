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

type Props = {
  src: string;
  kicker: string;
  title: string;
  durationInFrames: number;
};

// A scene: text column on the left, a framed product screenshot with a slow
// Ken Burns zoom on the right.
export const ShotScene = ({src, kicker, title, durationInFrames}: Props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const imgSpring = spring({frame, fps, config: {damping: 18, mass: 0.9}});
  const imgX = interpolate(imgSpring, [0, 1], [90, 0]);
  const imgOpacity = interpolate(frame, [0, 16], [0, 1], {extrapolateRight: 'clamp'});
  const zoom = interpolate(frame, [0, durationInFrames], [1.04, 1.13]);

  const textSpring = spring({frame: frame - 6, fps, config: {damping: 18}});
  const textX = interpolate(textSpring, [0, 1], [-50, 0]);
  const textOpacity = interpolate(frame, [6, 22], [0, 1], {
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
        flexDirection: 'row',
        alignItems: 'center',
        padding: '0 110px',
        gap: 64,
        fontFamily: FONT,
      }}
    >
      {/* text column */}
      <div
        style={{
          flex: '0 0 33%',
          transform: `translateX(${textX}px)`,
          opacity: textOpacity,
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2.5,
            color: COLORS.cyan,
            background: `${COLORS.cyan}1a`,
            border: `1px solid ${COLORS.cyan}44`,
          }}
        >
          {kicker}
        </div>
        <h2
          style={{
            marginTop: 28,
            fontSize: 64,
            lineHeight: 1.08,
            fontWeight: 800,
            letterSpacing: -1.5,
            color: COLORS.white,
            whiteSpace: 'pre-line',
          }}
        >
          {title}
        </h2>
      </div>

      {/* screenshot card */}
      <div
        style={{
          flex: 1,
          transform: `translateX(${imgX}px)`,
          opacity: imgOpacity,
          borderRadius: 20,
          overflow: 'hidden',
          border: `1px solid ${COLORS.cyan}33`,
          boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 60px ${COLORS.cyan}22`,
          background: '#000',
        }}
      >
        {/* faux browser bar */}
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 18px',
            background: '#11162a',
            borderBottom: `1px solid ${COLORS.cyan}1f`,
          }}
        >
          <span style={{width: 13, height: 13, borderRadius: 999, background: '#ff5f57'}} />
          <span style={{width: 13, height: 13, borderRadius: 999, background: '#febc2e'}} />
          <span style={{width: 13, height: 13, borderRadius: 999, background: '#28c840'}} />
        </div>
        <div style={{overflow: 'hidden'}}>
          <Img
            src={staticFile(src)}
            style={{width: '100%', display: 'block', transform: `scale(${zoom})`}}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
