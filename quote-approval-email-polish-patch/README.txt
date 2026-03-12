Quote approval email polish patch

Included:
- functions/quoteApprovalFlow.js
- notes/functions-index-additions.txt

What it adds:
- polished branded quote approval email
- quote summary table in email
- clear Approve / Request Changes / Reject actions
- mobile-friendly approval portal page
- comments box on the portal
- notifications written back to Firestore on response
- quote approval status + timestamps saved on the quote

After adding the exports, deploy:
firebase deploy --only functions
