import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Write the export to app cache and open the system share sheet; the temp file is removed afterwards. */
export async function saveExport(name: string, data: unknown): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your EdgeVitals data',
    });
  } finally {
    if (file.exists) file.delete();
  }
}
