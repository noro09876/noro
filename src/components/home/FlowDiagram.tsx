/** Custom automation schema: sources → NORO layer → destinations, with moving signal pulses. */
const SOURCES = [
  ['Формы и почта', 'заявки'],
  ['Чаты и мессенджеры', 'обращения'],
  ['Файлы', 'CSV · XLSX · PDF'],
  ['CRM / 1С / маркетплейсы', 'API'],
];
const OUTPUTS = [
  ['CRM', 'лиды с приоритетом'],
  ['Оператор', 'заявка с контекстом'],
  ['Учётная система', 'проверенные реквизиты'],
  ['Отчёт / Telegram', 'метрики и аномалии'],
];

export function FlowDiagram() {
  const W = 1000;
  const H = 360;
  const rowY = (i: number) => 50 + i * 82;
  const core = { x: 380, y: 95, w: 240, h: 170 };
  return (
    <div className="flow">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="flow-title flow-desc">
        <title id="flow-title">Схема автоматизации NORO</title>
        <desc id="flow-desc">Данные из форм, чатов, файлов и внешних систем проходят через слой обработки NORO: проверку, нормализацию, правила и модели, — и попадают в CRM, к оператору, в учётную систему и в отчёты.</desc>
        {SOURCES.map((_, i) => {
          const d = `M230,${rowY(i) + 22} C305,${rowY(i) + 22} 305,${core.y + core.h / 2} ${core.x},${core.y + core.h / 2}`;
          return (
            <g key={`s${i}`}>
              <path className="flow__path" d={d} />
              <path className="flow__pulse" d={d} style={{ animationDelay: `${i * 0.7}s` }} />
            </g>
          );
        })}
        {OUTPUTS.map((_, i) => {
          const d = `M${core.x + core.w},${core.y + core.h / 2} C695,${core.y + core.h / 2} 695,${rowY(i) + 22} 770,${rowY(i) + 22}`;
          return (
            <g key={`o${i}`}>
              <path className="flow__path" d={d} />
              <path className="flow__pulse" d={d} style={{ animationDelay: `${1.4 + i * 0.6}s` }} />
            </g>
          );
        })}
        {SOURCES.map(([t, s], i) => (
          <g key={t} className="flow__node" transform={`translate(20, ${rowY(i)})`}>
            <rect width="210" height="44" rx="10" />
            <text x="14" y="20">{t}</text>
            <text x="14" y="35" className="sub">{s}</text>
          </g>
        ))}
        <g className="flow__node flow__core" transform={`translate(${core.x}, ${core.y})`}>
          <rect width={core.w} height={core.h} rx="16" />
          <text x="20" y="34" style={{ fontWeight: 600, fontSize: 16 }}>Слой NORO</text>
          {['проверка и нормализация', 'правила и скоринг', 'поиск по базе знаний', 'модели (по подключению)'].map((l, i) => (
            <text key={l} x="20" y={66 + i * 24} className="sub" style={{ fontSize: 12 }}>
              — {l}
            </text>
          ))}
        </g>
        {OUTPUTS.map(([t, s], i) => (
          <g key={t} className="flow__node" transform={`translate(770, ${rowY(i)})`}>
            <rect width="210" height="44" rx="10" />
            <text x="14" y="20">{t}</text>
            <text x="14" y="35" className="sub">{s}</text>
          </g>
        ))}
      </svg>
      <ol className="flow__list">
        <li><b>Источники:</b> {SOURCES.map((x) => x[0]).join(', ')}</li>
        <li><b>Слой NORO:</b> проверка и нормализация, правила и скоринг, поиск по базе знаний, модели по подключению</li>
        <li><b>Результат:</b> {OUTPUTS.map((x) => `${x[0]} — ${x[1]}`).join('; ')}</li>
      </ol>
    </div>
  );
}
