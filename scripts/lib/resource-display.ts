import {parseResourceDeclaration, RESOURCE_ICON_PATHS, RESOURCE_LABELS, resourceText} from
  '@kubohiroya/turbowarp-extension-manifest/resources';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (en: string, ja: string) => `<span lang="en">${en}</span><span lang="ja">${ja}</span>`;

/** Use the same published, versioned declaration the Editor consumes, not repository HEAD metadata. */
export function catalogResourceDisplays(value: unknown): Map<string, {version: string; html: string}> {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
      !('extensions' in value) || !Array.isArray(value.extensions)) throw new Error('Expected an extension catalog');
  const result = new Map<string, {version: string; html: string}>();
  for (const entry of value.extensions) {
    if (!entry || typeof entry.package !== 'string' || typeof entry.version !== 'string') continue;
    let declaration;
    try { declaration = parseResourceDeclaration(entry.resourceDeclaration); } catch {
      result.set(entry.package, {version: entry.version, html: `<p class="resource-status">${t('Resource declaration unavailable', 'リソース利用の申告を読み取れません')}</p>`});
      continue;
    }
    const origin = `<span class="resource-origin">${t('Declaration for ', '宣言の対象版：')}${esc(entry.package)}@${esc(entry.version)}</span>`;
    let html: string;
    if (!declaration || !declaration.resources.length) {
      html = `<p class="resource-status">${declaration ? t('Resource use: none declared', 'リソース利用の申告：なし') : t('Resource use: not declared', 'リソース利用：未申告')}</p>`;
    } else {
      const chips = declaration.resources.map(item => {
        const label = t(esc(resourceText(RESOURCE_LABELS[item.type], 'en')), esc(resourceText(RESOURCE_LABELS[item.type], 'ja')));
        const direction = {download: t('Download', '取得'), upload: t('Upload', '送信'), bidirectional: t('Send and receive', '送受信')};
        return `<span class="resource-chip" title="${esc(resourceText(RESOURCE_LABELS[item.type], 'en'))} / ${esc(resourceText(RESOURCE_LABELS[item.type], 'ja'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${RESOURCE_ICON_PATHS[item.type]}"></path></svg><span class="resource-label">${label}${item.data ? ` · ${direction[item.data.direction]}` : ''}${item.access === 'permission-request' ? t(' · permission request', '・許可要求のみ') : ''}${item.usage === 'conditional' ? t(' (conditional)', '（条件付き）') : ''}</span></span>`;
      }).join('');
      const descriptions = declaration.resources.map(item => {
        const localized = (value: Parameters<typeof resourceText>[0]) => t(esc(resourceText(value, 'en')), esc(resourceText(value, 'ja')));
        const direction = {download: t('Download', '取得'), upload: t('Upload', '送信'), bidirectional: t('Send and receive', '送受信')};
        return `<div><dt>${localized(RESOURCE_LABELS[item.type])} · ${item.usage === 'required' ? t('Used by the main feature', '主要機能で利用') : t('Conditional use', '条件付きで利用')}</dt><dd>${localized(item.purpose)}</dd>${item.condition ? `<dd>${t('When: ', '利用条件：')}${localized(item.condition)}</dd>` : ''}${item.access === 'permission-request' ? `<dd>${t('Permission request only; see the purpose above.', '許可要求のある経路です。取得後の扱いは上記の用途を確認してください。')}</dd>` : ''}${item.data ? `<dd>${direction[item.data.direction]}：${localized(item.data.content)}</dd>` : ''}${item.via ? `<dd>${t('Through: ', '連携先：')}${esc(item.via.join(', '))}</dd>` : ''}</div>`;
      }).join('');
      html = `<details class="resource-disclosure"><summary title="Click or press Enter / クリックまたはEnterキーで展開"><span class="resource-heading">${t('Resource use (author declaration)', 'リソースの利用（製作者の申告）')}</span><span class="resource-chips">${chips}</span></summary><dl>${descriptions}</dl><p>${t('This declaration describes use; it does not grant browser permissions.', '利用内容の申告です。ブラウザの使用許可を与えるものではありません。')}</p></details>`;
    }
    result.set(entry.package, {version: entry.version, html: `<div data-resource-version="${esc(entry.version)}">${html}${origin}</div>`});
  }
  return result;
}
