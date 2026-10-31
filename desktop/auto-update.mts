export function isAutomaticUpdateSupported(
  platform: NodeJS.Platform,
  arch: string,
  packaged: boolean,
): boolean {
  // TODO(macOS): enable signed and notarized ZIP releases before using autoUpdater.
  return packaged && platform === 'win32' && arch === 'x64';
}
