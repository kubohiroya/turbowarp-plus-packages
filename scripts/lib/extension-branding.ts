/** Curated catalog artwork is independent of the pinned executable npm artifact. */
export const CATALOG_ICON_REPOSITORIES = Object.freeze([
  'turbowarp-sesame',
  'turbowarp-jsqr',
  'turbowarp-web-speech',
  'turbowarp-webusb-pasori',
  'turbowarp-uuid',
  'turbowarp-webrtc',
  'turbowarp-camera-source',
  'turbowarp-binary-data',
  'turbowarp-kvs',
] as const);

const icons = new Map<string, string>(CATALOG_ICON_REPOSITORIES.map(repository => [
  `@kubohiroya/${repository}`,
  `https://kubohiroya.github.io/turbowarp-plus-packages/assets/extension-icons/${repository}.svg`,
]));

/** Only explicitly maintained family packages receive catalog artwork overrides. */
export function catalogIconURL(packageName: string): string | undefined {
  return icons.get(packageName);
}
