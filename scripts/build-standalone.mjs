// Builds the standalone edition: the editor alone, in one folder that opens from the disk or any static host, with
// three.js copied in (no CDN needed). Designs are kept in the browser; the workshop imports its warsha-backup.json
// (from the server's full export) with Clients > Import. Used at the end of a contract, or as an offline fallback.
//   npm i three@0.147.0 (once, at the repository root)   then   node scripts/build-standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-standalone', 'warsha-studio');
const three = process.env.THREE_DIR || path.join(root, 'node_modules/three');
if (!fs.existsSync(path.join(three, 'build/three.min.js'))) { console.error('three@0.147.0 not found: npm i three@0.147.0'); process.exit(1); }
const version = JSON.parse(fs.readFileSync(path.join(three, 'package.json'), 'utf8')).version;
if (version !== '0.147.0') { console.error(`three ${version} found, the editor needs 0.147.0`); process.exit(1); }

fs.rmSync(path.join(root, 'dist-standalone'), {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to ?? from), {recursive: true});
copy('js'); copy('assets'); copy('og.jpg');
const used = [];
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.147\.0\/([\w/.-]+)/g, (_, p) => { used.push(p); return 'vendor/three/' + p; });
for (const p of used) { const dst = path.join(out, 'vendor/three', p); fs.mkdirSync(path.dirname(dst), {recursive: true}); fs.copyFileSync(path.join(three, p), dst); }
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'LISEZ-MOI.txt'), `Warsha Studio, version autonome
Ouvrir index.html dans Chrome, Edge ou Firefox (double clic), ou publier ce dossier sur n'importe quel hebergement statique.
Les projets sont gardes dans ce navigateur. Pour reprendre les donnees de l'atelier : Clients > Importer un fichier >
warsha-backup.json (dans l'export complet du serveur). Pensez a telecharger une sauvegarde complete regulierement.
Les devis deja emis sont dans le dossier devis/ de l'export, avec leur empreinte SHA-256.
three.js ${version} (licence MIT) est inclus dans vendor/three.
`);
try { execFileSync('python3', ['-c', 'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], "warsha-studio")', path.join(root, 'dist-standalone', 'warsha-studio-standalone'), path.join(root, 'dist-standalone')]); console.log('dist-standalone/warsha-studio-standalone.zip'); }
catch { console.log('folder ready (zip skipped): dist-standalone/warsha-studio'); }
console.log(`${used.length} three.js files vendored`);
