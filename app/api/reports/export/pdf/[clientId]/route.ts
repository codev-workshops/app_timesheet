import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGet, dbAll } from '@/lib/db';
import { handleApiError } from '@/lib/errorHandler';
import PDFDocument from 'pdfkit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { clientId: clientIdStr } = await params;
    const clientId = parseInt(clientIdStr);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    const client = await dbGet<{ id: number; name: string }>(
      'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const workEntries = await dbAll<{
      hours: number;
      description: string | null;
      date: string;
      created_at: string;
    }>(
      `SELECT hours, description, date, created_at
       FROM work_entries
       WHERE client_id = ? AND user_email = ?
       ORDER BY date DESC`,
      [clientId, authResult.userEmail]
    );

    const totalHours = workEntries.reduce(
      (sum, entry) => sum + parseFloat(String(entry.hours)),
      0
    );

    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(20).text(`Time Report for ${client.name}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text(`Total Hours: ${totalHours.toFixed(2)}`);
    doc.text(`Total Entries: ${workEntries.length}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.fontSize(12).text('Date', 50, doc.y, { width: 100 });
    doc.text('Hours', 150, doc.y - 15, { width: 80 });
    doc.text('Description', 230, doc.y - 15, { width: 300 });
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    workEntries.forEach((entry, index) => {
      const y = doc.y;

      if (y > 700) {
        doc.addPage();
      }

      doc.text(entry.date, 50, doc.y, { width: 100 });
      doc.text(entry.hours.toString(), 150, y, { width: 80 });
      doc.text(entry.description || 'No description', 230, y, { width: 300 });
      doc.moveDown();

      if ((index + 1) % 5 === 0) {
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
      }
    });

    doc.end();

    const pdfBuffer = await pdfPromise;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_report_${timestamp}.pdf`;

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
