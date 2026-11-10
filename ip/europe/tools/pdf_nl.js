// usage: node pdf_nl.js in.html out.pdf [landscape-pages-flag]
// A4, margins top/right/bottom 2 cm (bottom 3 cm so a page number sits inside the text zone), left 2.5 cm (OCNL format rules).
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.setContent(fs.readFileSync(process.argv[2],'utf8'));
await p.pdf({path:process.argv[3],format:'A4',preferCSSPageSize:process.argv[4]==='css',printBackground:false,
 margin:{top:'2cm',right:'2cm',bottom:'3cm',left:'2.5cm'}});
await b.close();})();
