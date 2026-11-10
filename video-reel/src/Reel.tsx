import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, prog } from "./anim";
import { DURATION, FONT_HEAD, FONT_LIGHT, WHITE, sec } from "./config";
import { ensureFonts } from "./fonts";
import { Broll, Cam, Speaker } from "./components/Footage";
import { Calendar, CommentBubble, Growth, HandleTag, IconFamily, IconPerson, Pill, Strike, TermLine, Vignette } from "./components/Graphics";
import { Headline, Light, Words } from "./components/Text";

ensureFonts();

// ─────────────────────────────────────────────────────────────────────────────
//  CUT LIST (seconds of the client's speech → frames). Edit times here.
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  hook: sec(0),          // «Я бы не поверил, если бы это не было реальностью»
  rate: sec(2.28),       // «Ставка 2% абсолютно для всех»
  kids: sec(4.7),        // «и не важно, есть у вас дети или нет»
  term: sec(6.88),       // «получаете вы эту программу на весь срок ипотеки»      → b-roll
  notFamily: sec(9.22),  // «это не какая-то семейная ипотека, а специальная государственная»
  date: sec(11.86),      // «программа, действующая с 1 января 26 года»            → b-roll
  limit: sec(15.56),     // «кстати, лимит по такой ипотеке всего 6 миллионов»
  pay: sec(17.46),       // «и платёж … в районе 20–22 тысяч рублей на весь срок»  → b-roll
  main: sec(21.18),      // «что самое главное, по этой программе квартиру вы можете взять даже у…»
  sea: sec(25.32),       // «…моря»                                               → b-roll
  sea2: sec(26.2),       // «то есть брать недвижимость на таких условиях»        → b-roll
  life: sec(27.66),      // «интересно не только для жизни»                       → b-roll
  invest: sec(29.0),     // «но и для вложений»                                   → b-roll
  cta: sec(29.86),       // «ну а тем, кто хочет больше подробностей, название ЖК, расчёт — пишите „2“ в комментариях»
  write: sec(32.6),      // «пишите „2“ в комментариях» — punch-in
  end: sec(33.95),       // «и я вам всё отправлю» → end card
};

// Speaker framing per shot: slow push/pull + different crops so the selfie never feels static
const CAMS: Cam[] = [
  { from: T.hook, to: T.rate, s0: 1.03, s1: 1.08, oy: 30 },
  { from: T.rate, to: T.kids, s0: 1.19, s1: 1.24, oy: 0 },
  { from: T.kids, to: T.term, s0: 1.3, s1: 1.26, oy: 14 },
  { from: T.notFamily, to: T.date, s0: 1.1, s1: 1.15, oy: 8 },
  { from: T.limit, to: T.pay, s0: 1.22, s1: 1.27, oy: 0 },
  { from: T.main, to: T.sea, s0: 1.05, s1: 1.16, oy: 6 },
  { from: T.cta, to: T.write, s0: 1.04, s1: 1.1, oy: 10 },
  { from: T.write, to: DURATION, s0: 1.2, s1: 1.3, oy: 0 },
];

const speakerOn = (f: number) =>
  f < T.term || (f >= T.notFamily && f < T.date) || (f >= T.limit && f < T.pay) || (f >= T.main && f < T.sea) || f >= T.cta;

/** Count-up that keeps the digit count stable (1.000.000 → 6.000.000). */
const Money: React.FC<{ at: number; from: number; to: number }> = ({ at, from, to }) => {
  const frame = useCurrentFrame();
  const v = Math.round((from + (to - from) * prog(frame, at, 16)) / 10000) * 10000;
  return <>{v.toLocaleString("ru-RU").replace(/\s/g, ".")}</>;
};

export const Reel: React.FC = () => {
  const frame = useCurrentFrame();
  // bright cloud passages get a stronger sky shade so the white type keeps its contrast
  const shade = frame >= T.cta ? 1.32 : frame >= T.kids && frame < T.date ? 1.15 : 1;
  const dim = interpolate(frame, [T.end - 2, T.end + 10], [0, 1], clamp);

  // Titles that live BEHIND the speaker (depth effect)
  const behind = (
    <>
      {/* giant 2% tucked behind the head */}
      <Headline at={sec(2.7)} out={T.kids} y={452} size={452} zoomFrom={1.9} tracking={-0.05} style={{ lineHeight: 1 }}>2%</Headline>
      {/* giant code word behind the head in the CTA */}
      <Headline at={sec(32.9)} out={T.end + 4} y={386} size={400} zoomFrom={1.9} tracking={-0.04} style={{ lineHeight: 1 }}>«2»</Headline>
    </>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* ───────────── PICTURE ───────────── */}
      {speakerOn(frame) ? <Speaker cams={CAMS} behind={behind} dim={dim} skyShade={shade} /> : null}
      <Broll src="broll/tower_white.jpg" from={T.term} to={T.notFamily} s0={1.02} s1={1.13} oy={38} />
      <Broll src="broll/towers_glass.jpg" from={T.date} to={T.limit} s0={1.14} s1={1.02} oy={30} />
      <Broll src="broll/apartments.jpg" from={T.pay} to={T.main} s0={1.03} s1={1.15} oy={45} />
      <Broll src="broll/sea_condos.jpg" from={T.sea} to={T.sea2} s0={1.1} s1={1.17} oy={55} />
      <Broll src="broll/coast_green.jpg" from={T.sea2} to={T.life} s0={1.16} s1={1.04} oy={60} />
      <Broll src="broll/resort.jpg" from={T.life} to={T.invest} s0={1.03} s1={1.13} oy={45} />
      <Broll src="broll/sea_condos_b.jpg" from={T.invest} to={T.cta} s0={1.14} s1={1.04} oy={45} />
      <Vignette />

      {/* ───────────── TYPE & GRAPHICS ───────────── */}
      {/* 1 · hook */}
      <Headline at={-6} out={T.rate} y={300} size={80}>Я бы не поверил</Headline>
      <Light at={sec(0.84)} out={T.rate - 1} y={408} size={45}>если бы это не было реальностью</Light>

      {/* 2 · 2% for everyone (the 2% itself is in `behind`) */}
      <Light at={sec(2.3)} out={sec(3.42)} y={318} size={64}>ставка</Light>
      <Headline at={sec(3.42)} out={T.kids} y={318} size={60} zoomFrom={1.8}>абсолютно для всех</Headline>

      {/* 3 · with or without kids */}
      <Light at={T.kids + 2} out={T.term - 2} y={292} size={62}>и не важно</Light>
      <Pill at={sec(5.5)} out={T.term - 1} x={540} y={392} label="ЕСТЬ ДЕТИ" icon={<IconFamily />} check={sec(5.92)} />
      <Pill at={sec(6.2)} out={T.term - 1} x={540} y={520} label="ИЛИ НЕТ" icon={<IconPerson />} check={sec(6.56)} />

      {/* 4 · for the whole term (b-roll) */}
      <Words items={[[T.term + 1, "получаете"], [sec(7.5), "эту программу"]]} end={sec(7.92)} y={330} size={62} />
      <Light at={sec(7.92)} out={T.notFamily - 1} y={290} size={56}>на весь</Light>
      <Headline at={sec(8.08)} out={T.notFamily} y={352} size={84}>срок ипотеки</Headline>
      <TermLine at={sec(8.02)} out={T.notFamily - 1} y={486} />

      {/* 5 · not a "family mortgage" → a state programme */}
      <Light at={T.notFamily + 2} out={sec(10.92)} y={292} size={58}>это не какая-то</Light>
      <Headline at={sec(9.84)} out={sec(10.94)} y={360} size={63} zoomFrom={1.9}>семейная ипотека</Headline>
      <Strike at={sec(10.36)} out={sec(10.94)} y={386} width={930} />
      <Light at={sec(10.92)} out={sec(12.42)} y={282} size={56} align="left" x={32}>а специальная</Light>
      <Headline at={sec(11.18)} out={sec(12.44)} y={344} size={66} align="right" zoomFrom={1.9} lineHeight={1.04} style={{ textAlign: "right" }}>{"государственная\nпрограмма"}</Headline>

      {/* 6 · from 1 January 2026 (b-roll) */}
      <Light at={sec(12.46)} out={T.limit - 1} y={288} size={58}>действует</Light>
      <Headline at={sec(13.06)} out={T.limit} y={352} size={76}>с 1 января 2026</Headline>
      <Calendar at={sec(13.1)} out={T.limit - 1} y={520} yearAt={sec(13.98)} />

      {/* 7 · limit */}
      <Light at={sec(15.86)} out={T.pay - 1} y={270} size={56}>лимит по ипотеке — всего</Light>
      <Headline at={sec(16.62)} out={T.pay} y={338} size={110} zoomFrom={2.2} tracking={-0.03}><Money at={sec(16.62)} from={1000000} to={6000000} /> ₽</Headline>

      {/* 8 · payment (b-roll) */}
      <Words items={[[sec(17.7), "платёж"], [sec(18.58), "в районе"]]} end={sec(20.2)} y={290} size={60} />
      <Headline at={sec(18.86)} out={T.main} y={356} size={132} zoomFrom={2.2} tracking={-0.03}>20–22</Headline>
      <Headline at={sec(19.68)} out={T.main} y={498} size={64} zoomFrom={1.7}>тысяч рублей</Headline>
      <Light at={sec(20.22)} out={T.main - 1} y={290} size={60}>на весь срок</Light>

      {/* 9 · the main thing */}
      <Light at={T.main + 2} out={sec(22.4)} y={300} size={62}>что самое главное</Light>
      <Light at={sec(22.42)} out={T.sea - 1} y={290} size={56}>по этой программе</Light>
      <Headline at={sec(23.22)} out={T.sea} y={352} size={104}>квартиру</Headline>
      <Light at={sec(23.8)} out={T.sea - 1} y={478} size={56}>можно взять даже у…</Light>

      {/* 10 · by the sea (b-roll) */}
      <Headline at={T.sea} out={T.sea2 + 10} y={300} size={236} zoomFrom={2.6} tracking={-0.03} style={{ lineHeight: 1 }}>моря</Headline>

      {/* 11 · living + investing (b-roll) */}
      <Words items={[[sec(26.56), "недвижимость"], [sec(27.0), "на таких условиях"]]} end={T.life + 2} y={330} size={60} />
      <Light at={T.life + 2} out={T.invest - 1} y={290} size={56}>интересно не только</Light>
      <Headline at={sec(28.24)} out={T.invest} y={352} size={96}>для жизни</Headline>
      <Light at={T.invest + 1} out={T.cta - 1} y={290} size={56}>но и</Light>
      <Headline at={sec(29.2)} out={T.cta} y={352} size={76}>для вложений</Headline>
      <Growth at={sec(29.24)} out={T.cta - 1} y={470} />

      {/* 12 · call to action */}
      <Light at={sec(30.5)} out={sec(32.6)} y={300} size={49}>хотите больше подробностей?</Light>
      <Pill at={sec(31.68)} out={sec(32.96)} x={372} y={388} label="НАЗВАНИЕ ЖК" size={34} />
      <Pill at={sec(32.3)} out={sec(32.96)} x={774} y={388} label="РАСЧЁТ" size={34} />
      <Light at={sec(32.62)} out={T.end + 2} y={316} size={60}>пишите в комментариях</Light>

      {/* 13 · end card */}
      <AbsoluteFill style={{ backgroundColor: "rgba(8,9,12,0.74)", opacity: dim }} />
      {frame >= T.end ? (
        <AbsoluteFill style={{ alignItems: "center" }}>
          <div style={{ marginTop: 640 }}><CommentBubble at={T.end + 4} /></div>
          <div style={{ marginTop: 44, fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 60, color: WHITE, letterSpacing: "-0.012em", opacity: prog(frame, T.end + 12, 10), translate: `0px ${(1 - prog(frame, T.end + 12, 10)) * 24}px` }}>В КОММЕНТАРИИ</div>
          <div style={{ marginTop: 22, fontFamily: FONT_LIGHT, fontWeight: 300, fontSize: 50, color: WHITE, opacity: prog(frame, sec(34.5), 10), translate: `0px ${(1 - prog(frame, sec(34.5), 10)) * 18}px` }}>и я вам всё отправлю</div>
          <div style={{ position: "absolute", top: 1240, width: "100%", display: "flex", justifyContent: "center" }}><HandleTag x={0} y={0} /></div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
