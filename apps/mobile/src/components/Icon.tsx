import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

export type IconName =
  | 'pulse'
  | 'heart'
  | 'chart'
  | 'shield'
  | 'lock'
  | 'person'
  | 'sun'
  | 'home'
  | 'chevronLeft'
  | 'chevronRight'
  | 'check'
  | 'flame'
  | 'settings'
  | 'camera'
  | 'alert'
  | 'close';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Stroke icon set drawn to match the reference wireframes. Decorative: hidden from screen readers. */
export function Icon({ name, size = 22, color = colors.primary, strokeWidth = 2 }: Props) {
  const p = {
    stroke: color,
    strokeWidth,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === 'pulse' && <Path d="M3 12h4l2.5-6 4 12 2.5-6H21" {...p} />}
      {name === 'heart' && (
        <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...p} />
      )}
      {name === 'chart' && (
        <>
          <Path d="M4 4v16h16" {...p} />
          <Path d="M7 15l4-5 3 3 5-6" {...p} />
        </>
      )}
      {name === 'shield' && (
        <>
          <Path d="M12 21s7-3.5 7-10V6l-7-3-7 3v5c0 6.5 7 10 7 10z" {...p} />
          <Path d="M12 9v5M9.5 11.5h5" {...p} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x={6} y={11} width={12} height={9} rx={2} {...p} />
          <Path d="M9 11V8a3 3 0 0 1 6 0v3" {...p} />
        </>
      )}
      {name === 'person' && (
        <>
          <Circle cx={12} cy={7} r={3} {...p} />
          <Path d="M7 21v-5a5 5 0 0 1 10 0v5" {...p} />
        </>
      )}
      {name === 'sun' && (
        <>
          <Circle cx={12} cy={12} r={3.5} {...p} />
          <Path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"
            {...p}
          />
        </>
      )}
      {name === 'home' && (
        <Path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" {...p} />
      )}
      {name === 'chevronLeft' && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === 'chevronRight' && <Path d="M9 5l7 7-7 7" {...p} />}
      {name === 'check' && <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />}
      {name === 'flame' && (
        <Path
          d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-9-1.5 2-2.5 3-3 5-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z"
          {...p}
        />
      )}
      {name === 'settings' && (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            {...p}
          />
        </>
      )}
      {name === 'camera' && (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4z" {...p} />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </>
      )}
      {name === 'alert' && (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 7.5v5.5M12 16.5v.01" {...p} />
        </>
      )}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...p} />}
    </Svg>
  );
}
