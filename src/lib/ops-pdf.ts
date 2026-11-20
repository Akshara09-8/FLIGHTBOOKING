import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { rfqEmail, type RfqInput } from "./ops";

/** One-page fare request letter to attach to the RFQ email (T4.2). */
export async function buildRfqPdf(input: RfqInput, sentOn: string): Promise<Uint8Array> {
  const { subject, lines } = rfqEmail(input);
  const pdf = await PDFDocument.create();
  pdf.setTitle(subject);
  pdf.setAuthor("GroupFly");
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.06, 0.37, 0.39);
  const ink = rgb(0.07, 0.16, 0.17);
  const muted = rgb(0.36, 0.44, 0.45);
  const left = 56;
  const width = 483;

  page.drawRectangle({ x: 0, y: 800, width: 595, height: 42, color: teal });
  page.drawText("GroupFly", { x: left, y: 814, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Group fare request", { x: left, y: 750, size: 20, font: bold, color: ink });
  page.drawText(`Date: ${sentOn}`, { x: left, y: 728, size: 10, font, color: muted });
  page.drawText(subject, { x: left, y: 706, size: 11, font: bold, color: ink, maxWidth: width });

  let y = 676;
  for (const line of lines) {
    if (line === "") {
      y -= 10;
      continue;
    }
    const isField = /^(Route|Date|Preferred|Passengers|Target fare):/.test(line);
    page.drawText(line, { x: isField ? left + 12 : left, y, size: 11, font: isField ? bold : font, color: ink, maxWidth: width, lineHeight: 14 });
    const wraps = Math.ceil(font.widthOfTextAtSize(line, 11) / width);
    y -= 16 * Math.max(1, wraps);
  }
  page.drawText("All fares in Indian rupees. Passenger names will be shared after the quote is accepted.", {
    x: left,
    y: 60,
    size: 9,
    font,
    color: muted,
  });
  return pdf.save();
}
