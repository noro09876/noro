import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';
import { clearAllData } from '../lib/storage';

export default function PrivacyPage() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 860 }}>
        <div className="prose">
          <span className="eyebrow">Данные</span>
          <h1 className="section-title" style={{ color: 'var(--text)' }}>
            Как демо-продукты обрабатывают данные
          </h1>
          <p>Все шесть продуктов на сайте работают в вашем браузере. Загруженные файлы (CSV, XLSX, TXT, PDF) читаются и обрабатываются локально и не отправляются на сервер NORO или третьим лицам.</p>
          <h2>Что сохраняется</h2>
          <ul>
            <li>Результаты работы (базы лидов, каталоги, проекты, история документов) сохраняются в хранилище браузера (IndexedDB) на этом устройстве, чтобы не потеряться при перезагрузке.</li>
            <li>Небольшие настройки (выбранные вкладки, черновик формы заявки) — в localStorage.</li>
            <li>Данные не синхронизируются между устройствами и браузерами. Если очистить данные сайта или использовать режим инкогнито, они пропадут — сохраняйте важные результаты через экспорт.</li>
          </ul>
          <h2>Что отправляется на сервер</h2>
          <ul>
            <li>Только форма заявки — после нажатия «Отправить». Данные формы используются, чтобы ответить на заявку.</li>
            <li>Внешние языковые модели в демо отключены. Если владелец сайта подключит модель, продукт явно покажет это и попросит включить её вручную; без этого текст никуда не передаётся.</li>
            <li>Сайт не подключает сторонние счётчики, шрифты или скрипты с других доменов.</li>
          </ul>
          <h2>Удалить все данные</h2>
          <p>Кнопка ниже удаляет всё, что демо-продукты сохранили в этом браузере. В каждом продукте есть отдельная кнопка «Сбросить».</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await clearAllData();
                setBusy(false);
                toast.success('Все данные NORO удалены из этого браузера');
              }}
            >
              <Icon name="trash" /> Удалить все данные демо
            </button>
            <Link to="/" className="btn btn--ghost">
              На главную
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
