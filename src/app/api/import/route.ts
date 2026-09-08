import { NextResponse } from 'next/server';
import { importExport, unzipExport } from '@/lib/letterboxd/ingest';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Upload path for /import, so a re-import can be done from a phone. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const files = file.name.endsWith('.zip')
      ? await unzipExport(buf)
      : { [file.name]: buf.toString('utf8') };

    if (!Object.keys(files).length) {
      return NextResponse.json({ error: 'No CSV files found in that upload' }, { status: 400 });
    }
    return NextResponse.json(await importExport(files));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
