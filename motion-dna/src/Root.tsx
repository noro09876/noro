import { Composition } from 'remotion';
import { Reel } from './Reel';
import type { Plan } from './plan';
import editorial from './plans/editorial_mask.json';
import punch from './plans/punch_poster.json';

const plans = [editorial, punch] as unknown as Plan[];

export const RemotionRoot: React.FC = () => (
  <>
    {plans.map((plan) => (
      <Composition
        key={plan.style}
        id={plan.style.replace(/_/g, '-')}
        component={Reel}
        durationInFrames={plan.durationInFrames}
        fps={plan.fps}
        width={plan.width}
        height={plan.height}
        defaultProps={{ plan }}
      />
    ))}
  </>
);
