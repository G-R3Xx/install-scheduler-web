import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import AttachmentRoundedIcon from "@mui/icons-material/AttachmentRounded";
import TextSnippetRoundedIcon from "@mui/icons-material/TextSnippetRounded";
import HtmlRoundedIcon from "@mui/icons-material/HtmlRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase/firebase";

function formatDate(value) {
  try {
    const d = value?.toDate ? value.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  } catch {
    return "—";
  }
}

function buildHtmlDoc(html) {
  const body = (html || "").toString();
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          margin: 0;
          padding: 12px;
          line-height: 1.45;
          word-break: break-word;
        }
        img { max-width: 100%; height: auto; }
        table { max-width: 100%; }
        a { color: #1976d2; }
      </style>
    </head>
    <body>${body}</body>
  </html>`;
}

export default function LeadEmailsPanel({
  leadId,
  onUseEmailContext,
  defaultOpenLatest = false,
}) {
  const [emails, setEmails] = useState([]);
  const [err, setErr] = useState("");
  const [openMap, setOpenMap] = useState({});
  const [busyPath, setBusyPath] = useState("");
  const [viewModeMap, setViewModeMap] = useState({});

  useEffect(() => {
    if (!leadId) return undefined;

    const q = query(
      collection(db, "leads", leadId, "emails"),
      orderBy("parsedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const nextEmails = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setErr("");
        setEmails(nextEmails);

        if (defaultOpenLatest && nextEmails.length) {
          setOpenMap((prev) => {
            if (Object.keys(prev).length) return prev;
            return { [nextEmails[0].id]: true };
          });
        }
      },
      (e) => {
        console.error(e);
        setErr(e?.message || "Failed to load parsed emails");
      }
    );

    return () => unsub();
  }, [leadId, defaultOpenLatest]);

  const emailCount = useMemo(() => emails.length, [emails]);

  const toggleOpen = (id) => {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openAttachment = async (storagePath) => {
    if (!storagePath || !storage) return;
    setBusyPath(storagePath);
    try {
      const url = await getDownloadURL(ref(storage, storagePath));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to open attachment");
    } finally {
      setBusyPath("");
    }
  };

  if (!leadId) return null;

  return (
    <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <MailOutlineRoundedIcon />
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          Email Timeline
        </Typography>
        <Chip size="small" label={`${emailCount}`} />
      </Stack>

      <Typography sx={{ opacity: 0.78, mb: 2 }}>
        Uploaded .eml files are parsed and shown here with inline preview, original email access, and downloadable parsed attachments.
      </Typography>

      {err ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      ) : null}

      <Stack spacing={1.25}>
        {emails.map((email) => {
          const isOpen = openMap[email.id] === true;
          const attachmentCount = Number(email.attachmentCount || 0);
          const hasHtml = !!(email.htmlBody || "").trim();
          const viewMode = viewModeMap[email.id] || (hasHtml ? "html" : "text");

          return (
            <Paper key={email.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  alignItems={{ md: "center" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 900 }}>
                        {email.subject || "(No subject)"}
                      </Typography>
                      <Chip size="small" label="Email" variant="outlined" />
                      {hasHtml ? <Chip size="small" label="HTML" color="secondary" variant="outlined" /> : null}
                      {attachmentCount > 0 ? (
                        <Chip
                          size="small"
                          icon={<AttachmentRoundedIcon />}
                          label={`${attachmentCount} parsed attachment${attachmentCount === 1 ? "" : "s"}`}
                          variant="outlined"
                        />
                      ) : null}
                    </Stack>

                    <Typography sx={{ opacity: 0.82, fontSize: 13, mt: 0.25 }}>
                      <strong>From:</strong> {email.fromText || "—"}
                    </Typography>

                    <Typography sx={{ opacity: 0.82, fontSize: 13 }}>
                      <strong>To:</strong> {email.toText || "—"}
                    </Typography>

                    <Typography sx={{ opacity: 0.65, fontSize: 12 }}>
                      {formatDate(email.emailDate)}
                    </Typography>

                    {email.snippet ? (
                      <Typography sx={{ opacity: 0.8, mt: 0.75 }}>
                        {email.snippet}
                      </Typography>
                    ) : null}
                  </Box>

                  <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
                    {email.fileUrl ? (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<LaunchRoundedIcon />}
                        onClick={() => window.open(email.fileUrl, "_blank", "noopener,noreferrer")}
                        sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                      >
                        Open Original
                      </Button>
                    ) : null}

                    {typeof onUseEmailContext === "function" ? (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<AutoFixHighRoundedIcon />}
                        onClick={() => onUseEmailContext(email)}
                        sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                      >
                        Use in Lead
                      </Button>
                    ) : null}

                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<ExpandMoreRoundedIcon />}
                      onClick={() => toggleOpen(email.id)}
                      sx={{ textTransform: "none", borderRadius: 2, fontWeight: 800 }}
                    >
                      {isOpen ? "Hide" : "View"}
                    </Button>
                  </Stack>
                </Stack>

                <Collapse in={isOpen}>
                  <Divider sx={{ my: 1.25 }} />

                  {(email.ccText || "").trim() ? (
                    <Typography sx={{ opacity: 0.82, fontSize: 13, mb: 1 }}>
                      <strong>CC:</strong> {email.ccText}
                    </Typography>
                  ) : null}

                  <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap" }}>
                    <Chip
                      size="small"
                      icon={<TextSnippetRoundedIcon />}
                      label="Text View"
                      color={viewMode === "text" ? "primary" : "default"}
                      onClick={() => setViewModeMap((p) => ({ ...p, [email.id]: "text" }))}
                      variant={viewMode === "text" ? "filled" : "outlined"}
                    />
                    {hasHtml ? (
                      <Chip
                        size="small"
                        icon={<HtmlRoundedIcon />}
                        label="HTML View"
                        color={viewMode === "html" ? "secondary" : "default"}
                        onClick={() => setViewModeMap((p) => ({ ...p, [email.id]: "html" }))}
                        variant={viewMode === "html" ? "filled" : "outlined"}
                      />
                    ) : null}
                  </Stack>

                  {attachmentCount > 0 ? (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography sx={{ fontWeight: 800, mb: 0.75 }}>
                        Parsed Email Attachments
                      </Typography>

                      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
                        {(email.attachments || []).map((a, idx) => (
                          <Button
                            key={`${email.id}-att-${idx}`}
                            variant="outlined"
                            size="small"
                            startIcon={<AttachmentRoundedIcon />}
                            onClick={() => openAttachment(a.storagePath)}
                            disabled={!a.storagePath || busyPath === a.storagePath}
                            sx={{ textTransform: "none", borderRadius: 2 }}
                          >
                            {a.filename || "Attachment"}
                          </Button>
                        ))}
                      </Stack>
                    </Box>
                  ) : null}

                  <Typography sx={{ fontWeight: 800, mb: 0.5 }}>
                    Email Body
                  </Typography>

                  {viewMode === "html" && hasHtml ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        borderRadius: 2,
                        overflow: "hidden",
                        height: 420,
                        backgroundColor: "background.paper",
                      }}
                    >
                      <iframe
                        title={`email-html-${email.id}`}
                        srcDoc={buildHtmlDoc(email.htmlBody)}
                        sandbox=""
                        style={{
                          width: "100%",
                          height: "420px",
                          border: "none",
                          display: "block",
                          background: "#fff",
                        }}
                      />
                    </Paper>
                  ) : (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        backgroundColor: "background.default",
                        maxHeight: 420,
                        overflow: "auto",
                      }}
                    >
                      <Typography
                        component="pre"
                        sx={{
                          m: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "inherit",
                          fontSize: 14,
                        }}
                      >
                        {email.textBody || "No plain text body was extracted from this email."}
                      </Typography>
                    </Paper>
                  )}
                </Collapse>
              </Stack>
            </Paper>
          );
        })}

        {emails.length === 0 ? (
          <Alert severity="info">
            No parsed emails yet. Upload a <code>.eml</code> file to the lead’s
            email attachments area and the parser will populate this section.
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
