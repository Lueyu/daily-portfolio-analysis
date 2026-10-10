'use client';

/**
 * Uploads a File object to the platform object storage (dataloom) default bucket
 * and returns its stored location metadata.
 * Part of the vendored business-ui component library.
 */
import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { getDefaultBucketId } from '@lark-apaas/client-toolkit/tools/storage';

/** Metadata describing a file that has been uploaded to object storage. */
export interface UploadFileData {
  id: string;
  filePath: string;
  bucketId: string;
  url: string;
}

/** Uploads the given file to the default storage bucket; throws on upload error. */
export async function uploadFile(file: File): Promise<UploadFileData> {
  const dataloom = await getDataloom();
  const bucket = dataloom.storage.from(getDefaultBucketId());

  const result = await bucket.uploadFile(file);

  if (result.error) {
    throw result.error;
  }

  return {
    id: result.data.id,
    filePath: result.data.file_path,
    bucketId: result.data.bucket_id,
    url: result.data.download_url,
  };
}
