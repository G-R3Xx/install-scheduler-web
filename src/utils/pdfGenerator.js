
// src/utils/pdfGenerator.js
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Safely converts a Firestore Timestamp or a JS Date/string/number to a locale string.
 */
function formatDate(timestampOrDate) {
  if (!timestampOrDate) return "";
  // If it’s a Firestore Timestamp:
  if (timestampOrDate.toDate && typeof timestampOrDate.toDate === "function") {
    return timestampOrDate.toDate().toLocaleString();
  }
  // Otherwise assume it’s something Date can parse (Date instance, ISO string, or epoch)
  const dateObj = new Date(timestampOrDate);
  if (!isNaN(dateObj)) {
    return dateObj.toLocaleString();
  }
  return ""; // fallback if unrecognized
}

/**
 * generatePDF: Creates a PDF of the job details (including photos & signature).
 * @param {Object} options
 *   - jobId: string
 *   - job: object (fields from Firestore)
 *   - referencePhotos: array of URLs
 *   - signatureCanvas: ref to a SignatureCanvas instance (optional)
 */
export default async function generatePDF({
  jobId,
  job,
  referencePhotos,
  signatureCanvas,
}) {
  try {
    // 1. Build a hidden container
    const container = document.createElement("div");
    container.style.padding = "20px";
    container.style.fontFamily = "Helvetica, Arial, sans-serif";
    container.style.backgroundColor = "#fff";
    container.style.width = "800px";
    container.style.color = "#000";

    // Use formatDate() instead of directly calling toDate()
    const createdAtText = formatDate(job.createdAt);
    const updatedAtText = formatDate(job.updatedAt);

    container.innerHTML = `
      <h1>Job Report: ${job.clientName}</h1>
      <p><strong>Address:</strong> ${job.address || ""}</p>
      <p><strong>Phone:</strong> ${job.phone || ""}</p>
      <p><strong>Email:</strong> ${job.email || ""}</p>
      <p><strong>Status:</strong> ${job.status || ""}</p>
      <p><strong>Created At:</strong> ${createdAtText}</p>
      <p><strong>Updated At:</strong> ${updatedAtText}</p>
      <hr />
      <h2>Reference Photos</h2>
      <div id="photos">
        ${referencePhotos
          .map((url) => `<img src="${url}" style="width:200px; margin:5px" />`)
          .join("")}
      </div>
      <hr />
      <h2>Signature</h2>
      ${
        signatureCanvas && !signatureCanvas.isEmpty()
          ? `<img src="${signatureCanvas.getCanvas().toDataURL("image/png")}" style="width:400px;" />`
          : "<p>No signature provided.</p>"
      }
    `;

    document.body.appendChild(container);
    // Wait a moment for images to load
    await new Promise((res) => setTimeout(res, 500));

    // 2. Capture via html2canvas
    const canvas = await html2canvas(container, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "px",
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);

    // 3. Trigger download
    pdf.save(`JobReport_${jobId}.pdf`);

    // 4. Clean up
    document.body.removeChild(container);
  } catch (err) {
    console.error("PDF generation error:", err);
    alert("Failed to generate PDF: " + err.message);
  }
}
