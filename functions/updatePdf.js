import fetch from "node-fetch";
import fs from "fs";
import { PDFDocument, rgb } from "pdf-lib";
import dotenv from "dotenv";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { basename } from "path";
import { stringify } from "csv-stringify/sync";

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});

const drive = google.drive({ version: "v3", auth });
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const TEMPLATE_FILE_NAME =
  "KCPE-Hatua-Network-Secondary-Application-_-2024.pdf";

const AIRTABLE_HEADERS = {
  Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
  "Content-Type": "application/json",
};

function groupByEmail(records) {
  if (!Array.isArray(records)) {
    console.error("Expected an array of records, but received:", records);
    return {};
  }

  return records.reduce((acc, record) => {
    const email = record.email;
    const phoneNumber = record.phoneNumber || "Not provided";

    if (!email) return acc;

    if (!acc[email]) {
      acc[email] = { records: [], phoneNumber }; // Store phone number once
    }

    acc[email].records.push(record); // Add record under the email

    return acc;
  }, {});
}

// *Update PDF*
async function updatePDF(serialNumber, qrCodeData) {
  try {
    console.log("Loading existing PDF template...");
    const existingPdfBytes = fs.readFileSync(`./${TEMPLATE_FILE_NAME}`);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const firstPage = pdfDoc.getPages()[0];

    // Update Serial Number
    firstPage.drawText(`${serialNumber}`, {
      x: 140,
      y: 554,
      size: 14,
      color: rgb(0, 0, 0),
    });
    firstPage.drawText(`${serialNumber}`, {
      x: 140.5,
      y: 554,
      size: 14,
      color: rgb(0, 0, 0),
    });
    firstPage.drawText(`${serialNumber}`, {
      x: 140,
      y: 553.5,
      size: 14,
      color: rgb(0, 0, 0),
    });

    // Fetch and Embed QR Code
    console.log("Fetching QR Code...");
    const qrResponse = await fetch(qrCodeData);
    const qrImageBytes = await qrResponse.arrayBuffer();
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    firstPage.drawImage(qrImage, {
      x: 500,
      y: 700,
      width: qrImage.width * 0.5,
      height: qrImage.height * 0.5,
    });

    console.log("Saving updated PDF...");
    const pdfBytes = await pdfDoc.save();
    const outputPath = `./Hatua_Application_${serialNumber}.pdf`;
    fs.writeFileSync(outputPath, pdfBytes);
    return outputPath;
  } catch (error) {
    console.error("Error updating PDF:", error);
    return null;
  }
}

// *Upload to Google Drive*
async function uploadToDrive(filePath, fileName) {
  try {
    console.log(`Uploading ${fileName} to Google Drive...`);

    const driveResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [GOOGLE_DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/pdf",
        body: fs.createReadStream(filePath),
      },
      fields: "id, webViewLink",
    });

    if (!driveResponse.data.id) {
      console.error("Failed to upload: No file ID returned.");
      return null;
    }

    await drive.permissions.create({
      fileId: driveResponse.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    console.log(`Uploaded successfully: ${driveResponse.data.webViewLink}`);
    return driveResponse.data.webViewLink;
  } catch (error) {
    console.error("Error uploading to Google Drive:", error);
    return null;
  }
}

// *Extract Serial Number*
function extractSerialNumber(fileName) {
  const match = fileName.match(/Hatua_Application_(\d+)\.pdf/);
  return match ? parseInt(match[1], 10) : 0;
}

// *Merge PDFs*
async function mergePDFs(pdfPaths) {
  const mergedPdf = await PDFDocument.create();
  pdfPaths.sort((a, b) => extractSerialNumber(a) - extractSerialNumber(b));

  for (const pdfPath of pdfPaths) {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(
      pdfDoc,
      pdfDoc.getPageIndices()
    );
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedPdfBytes = await mergedPdf.save();
  const mergedPdfPath = "./merged_output.pdf";
  fs.writeFileSync(mergedPdfPath, mergedPdfBytes);
  return mergedPdfPath;
}

// *Generate CSV*
function generateCSV(groupedRecords) {
  const csvPaths = {};

  Object.entries(groupedRecords).forEach(([email, records]) => {
    try {
      if (!Array.isArray(records)) {
        console.error(`Invalid records for ${email}:`, records);
        return;
      }

      const headers = ["Serial Number", "Google Drive Link"];

      // Sort records by Serial Number (numerically)
      records.sort((a, b) => {
        const numA = parseInt(a["Serial Number"], 10) || 0;
        const numB = parseInt(b["Serial Number"], 10) || 0;
        return numA - numB;
      });

      const rows = records.map((record) => {
        let serialNumber = record["Serial Number"] || "N/A";
        const driveLink = record["Google Drive Link"] || "N/A";

        if (serialNumber !== "N/A") {
          serialNumber = `'${serialNumber}`;
        }

        if (serialNumber === "N/A" || driveLink === "N/A") {
          console.warn(`Missing data for ${email}:`, record);
        }

        return [serialNumber, driveLink];
      });

      const csvContent = stringify([headers, ...rows], { header: false });
      const csvPath = `./merged_records.csv`;
      fs.writeFileSync(csvPath, csvContent);

      console.log(`CSV file generated successfully for ${email}: ${csvPath}`);
      csvPaths[email] = csvPath;
    } catch (error) {
      console.error(`Error generating CSV for ${email}:`, error);
    }
  });

  return csvPaths;
}

// *Send Email*
async function sendEmail(recipient, pdfPath, csvPath, phoneNumber) {
  const emailBodyTemplate = process.env.EMAIL_BODY;

  const emailBody = emailBodyTemplate
    .replace(
      "{{SCHOLARSHIP_APPLICANTS_CHAMPION}}",
      process.env.SCHOLARSHIP_APPLICANTS_CHAMPION
    )
    .replace("{{phoneNumber}}", phoneNumber)
    .replace("{{SCHOLARSHIP_APPLICANTS}}", process.env.SCHOLARSHIP_APPLICANTS)
    .replace("{{SENDER_NAME}}", process.env.SENDER_NAME)
    .replace("{{SENDER_TEAM}}", process.env.SENDER_TEAM);
  const emailSubject = process.env.EMAIL_SUBJECT;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SENDER_NAME}" <${process.env.EMAIL_USER}>`,
      to: recipient,
      subject: emailSubject,
      messageId: `<${Date.now()}-${Math.random().toString(36).substr(2, 9)}@${
        process.env.EMAIL_DOMAIN
      }>`,
      headers: {
        "X-Entity-Ref-ID": Date.now().toString(),
      },
      text: emailBody,

      attachments: [
        { filename: basename(pdfPath), path: pdfPath },
        { filename: basename(csvPath), path: csvPath },
      ],
    });

    console.log(`Email sent response:`, info);

    if (info.rejected.length > 0) {
      console.warn(`Email to ${recipient} was rejected.`);
    } else {
      console.log(`Email sent successfully to ${recipient}.`);
    }
  } catch (error) {
    console.error(`Failed to send email to ${recipient}:`, error);
  }
}

async function updateAirtable(recordId, driveLink) {
  try {
    console.log(`Updating Airtable record ${recordId}...`);

    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.BASE_ID}/${process.env.TABLE_NAME}/${recordId}`,
      {
        method: "PATCH",
        headers: AIRTABLE_HEADERS,
        body: JSON.stringify({
          fields: {
            "Application Form PDF": driveLink,
            Status: "Form Shared on Email",
          },
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        `Failed to update record ${recordId}: ${JSON.stringify(result)}`
      );
    }

    console.log(`Airtable record ${recordId} updated successfully:`, result);

    // Wait to prevent rate limit issues
    await new Promise((res) => setTimeout(res, 500));
  } catch (error) {
    console.error(`Error updating Airtable record ${recordId}:`, error);
  }
}

export async function main(webhookData) {
  const { records } = webhookData;

  const groupedRecords = groupByEmail(records);

  for (const [email, { records, phoneNumber }] of Object.entries(
    groupedRecords
  )) {
    const pdfPaths = [];
    const csvRecords = [];

    for (const record of records) {
      try {
        const serialNumber = record.serialNumber;
        const qrCodeData = record.qrCodeUrl;
        const recordId = record.recordId;
        const pdfPath = await updatePDF(serialNumber, qrCodeData);
        const driveLink = await uploadToDrive(
          pdfPath,
          `Hatua_Application_${serialNumber}.pdf`
        );

        await updateAirtable(recordId, driveLink);

        pdfPaths.push(pdfPath);
        csvRecords.push({
          "Serial Number": serialNumber,
          "Google Drive Link": driveLink,
        });
      } catch (error) {
        console.error(`Error processing record for ${email}:`, error);
      }
    }

    if (pdfPaths.length === 0) {
      console.warn(`Skipping email ${email} - No valid PDFs generated.`);
      continue;
    }

    const mergedPdfPath = await mergePDFs(pdfPaths);

    const csvPaths = generateCSV({ [email]: csvRecords });
    const csvPath = csvPaths[email];

    if (!csvPath) {
      console.error(`Skipping email ${email} due to CSV generation failure.`);
      continue;
    }

    await sendEmail(email, mergedPdfPath, csvPath, phoneNumber);
  }
}
