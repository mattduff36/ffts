import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root=process.cwd();
const out=path.join(root,'public/branding');
const original=await fs.readFile(path.join(out,'forest-farm-tree-services-logo-original.png'));
const source='data:image/png;base64,'+original.toString('base64');
const filters='<defs><filter id="white"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter><filter id="black"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter><filter id="bright"><feComponentTransfer><feFuncR type="linear" slope="1.7"/><feFuncG type="linear" slope="1.7"/><feFuncB type="linear" slope="1.7"/></feComponentTransfer></filter><clipPath id="leaf"><rect width="94" height="88"/></clipPath><clipPath id="wordmark"><rect x="94" width="206" height="88"/></clipPath></defs>';
const img=`<image href="${source}" width="300" height="88"/>`;
const wrap=(w,h,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Forest Farm Tree Services">${body}</svg>`;
const darkBody=filters+`<g clip-path="url(#leaf)" filter="url(#bright)">${img}</g><g clip-path="url(#wordmark)" filter="url(#white)">${img}</g>`;
const variants={
 'logo-light':wrap(300,88,img),
 'logo-dark':wrap(300,88,darkBody),
 'logo-monochrome-white':wrap(300,88,filters+`<g filter="url(#white)">${img}</g>`),
 'logo-monochrome-black':wrap(300,88,filters+`<g filter="url(#black)">${img}</g>`),
 'leaf-transparent':wrap(94,88,img),
 'leaf-on-light':wrap(256,256,`<rect width="256" height="256" rx="54" fill="#f5f7f1"/><svg x="32" y="38" width="192" height="180" viewBox="0 0 94 88">${img}</svg>`),
 'leaf-on-dark':wrap(256,256,`<rect width="256" height="256" rx="54" fill="#131614"/><svg x="32" y="38" width="192" height="180" viewBox="0 0 94 88">${filters}<g filter="url(#bright)">${img}</g></svg>`),
 'ios-app-icon':wrap(256,256,`<rect width="256" height="256" fill="#f5f7f1"/><svg x="52" y="24" width="152" height="143" viewBox="0 0 94 88">${img}</svg><text x="128" y="222" fill="#153d22" font-family="Arial,sans-serif" font-size="46" font-weight="700" letter-spacing="2" text-anchor="middle">FFTS</text>`),
 'social-card':wrap(1200,630,`<rect width="1200" height="630" fill="#131614"/><rect x="80" y="75" width="1040" height="4" fill="#a0d06d"/><svg x="120" y="150" width="960" height="282" viewBox="0 0 300 88">${darkBody}</svg><text x="600" y="505" fill="#d4dad5" font-family="Arial,sans-serif" font-size="32" text-anchor="middle">Field Operations</text>`),
};
for(const [name,svg] of Object.entries(variants)){await fs.writeFile(path.join(out,name+'.svg'),svg);await sharp(Buffer.from(svg),{density:name==='social-card'?72:144}).png().toFile(path.join(out,name+'.png'))}
const icon=Buffer.from(variants['leaf-on-light']);
for(const size of [16,32,48,192,512]){await sharp(icon).resize(size,size).png().toFile(path.join(out,`icon-${size}.png`))}
const mask=wrap(512,512,`<rect width="512" height="512" fill="#f5f7f1"/><svg x="102" y="112" width="308" height="288" viewBox="0 0 94 88">${img}</svg>`);
await sharp(Buffer.from(mask)).png().toFile(path.join(out,'icon-maskable-512.png'));
await fs.writeFile(path.join(root,'public/favicon.svg'),variants['leaf-on-light']);
const pngs=await Promise.all([16,32,48].map(n=>sharp(icon).resize(n,n).png().toBuffer()));
const header=Buffer.alloc(6+16*pngs.length);header.writeUInt16LE(1,2);header.writeUInt16LE(pngs.length,4);let offset=header.length;pngs.forEach((b,i)=>{const at=6+16*i,n=[16,32,48][i];header[at]=n;header[at+1]=n;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(b.length,at+8);header.writeUInt32LE(offset,at+12);offset+=b.length});await fs.writeFile(path.join(root,'app/favicon.ico'),Buffer.concat([header,...pngs]));
for(const size of [120,152,167,180]){const png=await sharp(Buffer.from(variants['ios-app-icon'])).resize(size,size).flatten({background:'#f5f7f1'}).png().toBuffer();for(const name of [`apple-touch-icon-${size}x${size}.png`,`apple-touch-icon-${size}x${size}-precomposed.png`,...(size===180?['apple-touch-icon.png','apple-touch-icon-precomposed.png']:[])])await fs.writeFile(path.join(root,'public',name),png)}
for(const size of [192,512])await fs.copyFile(path.join(out,`icon-${size}.png`),path.join(root,`public/icon-${size}x${size}.png`));
// Preserve established asset URLs for environment overrides and PDF logo loading.
await fs.writeFile(path.join(root,'public/images/forest-farm/logo.svg'),variants['logo-light']);
await fs.copyFile(path.join(out,'logo-light.png'),path.join(root,'public/images/forest-farm/logo.png'));
await fs.writeFile(path.join(root,'public/images/forest-farm/favicon.svg'),variants['leaf-on-light']);
await fs.copyFile(path.join(out,'logo-light.png'),path.join(root,'public/images/logo.png'));
console.log('Generated logo variants, leaf icons, ICO, Apple/PWA icons and social card from the original artwork.');
