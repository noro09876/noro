import React from 'react';
import {Composition, Still} from 'remotion';
import {Short, SHORT_DURATION} from './Short';
import {SLIDES} from './Carousel';
import {Long, LONG_DURATION} from './Long';
import {Story1, Story2, Story3, ReelCover} from './Stories';

export const Root: React.FC = () => (
  <>
    <Composition id="Short" component={Short} durationInFrames={Math.ceil(SHORT_DURATION * 30)} fps={30} width={1080} height={1920} />
    <Composition id="Long" component={Long} durationInFrames={Math.ceil(LONG_DURATION * 30)} fps={30} width={1920} height={1080} />
    {SLIDES.map((S, i) => (
      <Still key={i} id={`Slide${i + 1}`} component={S} width={1080} height={1350} />
    ))}
    <Still id="Story1" component={Story1} width={1080} height={1920} />
    <Still id="Story2" component={Story2} width={1080} height={1920} />
    <Still id="Story3" component={Story3} width={1080} height={1920} />
    <Still id="ReelCover" component={ReelCover} width={1080} height={1920} />
  </>
);
