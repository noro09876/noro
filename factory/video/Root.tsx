import React from 'react';
import { Composition, Still } from 'remotion';
import { Promo, promoDuration, FPS, type PromoProps } from './Promo';
import { GraphicStill, SlideStill, type GraphicProps, type SlideProps } from './still/Stills';
import { NORO_VISUAL } from './theme';

export const SIZES = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
} as const;

const samplePromo: PromoProps = {
  brandName: 'NORO',
  visual: NORO_VISUAL,
  aspect: '9:16',
  showCaptions: true,
  label: 'demo',
  captions: [],
  scenes: [
    { id: 'a', kind: 'hook', title: 'Одна идея — десять площадок', text: 'Контент-завод NORO', voiceover: '', durationSec: 3 },
    { id: 'b', kind: 'ui', title: 'Очередь публикаций', voiceover: '', durationSec: 3, visual: { type: 'ui', title: 'Публикации', rows: [{ label: 'Telegram', value: '10:00', tone: 'good' }, { label: 'VK', value: '12:30' }, { label: 'YouTube Shorts', value: '18:00', tone: 'warn' }] } },
    { id: 'c', kind: 'cta', title: 'Попробуйте', text: 'noro.studio', voiceover: '', durationSec: 2.5 },
  ],
  timeline: [
    { sceneId: 'a', fromMs: 0, durationMs: 3000 },
    { sceneId: 'b', fromMs: 3000, durationMs: 3000 },
    { sceneId: 'c', fromMs: 6000, durationMs: 2500 },
  ],
};

const sampleSlide: SlideProps = {
  brandName: 'NORO',
  visual: NORO_VISUAL,
  index: 0,
  total: 5,
  aspect: '4:5',
  slide: { kicker: 'кейс', title: 'Как сократить подготовку контента в 5 раз', body: 'Один бриф превращается в стратегию, тексты, карусели и видео.', visual: { type: 'stat', value: '5×', label: 'быстрее подготовка' } },
};

const sampleGraphic: GraphicProps = {
  brandName: 'NORO',
  visual: NORO_VISUAL,
  aspect: '4:5',
  headline: 'Весь путь контента — на одном экране',
  subline: 'От идеи до аналитики',
  block: { type: 'chart', points: [2, 4, 3, 6, 7, 9], label: 'публикации в неделю' },
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={300}
      defaultProps={samplePromo}
      calculateMetadata={({ props }) => ({ durationInFrames: promoDuration(props), ...SIZES[props.aspect] })}
    />
    <Still id="Slide" component={SlideStill} width={1080} height={1350} defaultProps={sampleSlide} calculateMetadata={({ props }) => SIZES[props.aspect]} />
    <Still id="Graphic" component={GraphicStill} width={1080} height={1350} defaultProps={sampleGraphic} calculateMetadata={({ props }) => SIZES[props.aspect]} />
  </>
);
