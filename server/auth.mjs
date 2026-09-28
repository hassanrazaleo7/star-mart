import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
export const id=()=>randomBytes(16).toString('hex');
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function passwordHash(password,salt){return scryptSync(password,salt,64).toString('hex')}
export function verify(password,salt,expected){let a=Buffer.from(passwordHash(password,salt),'hex'),b=Buffer.from(expected,'hex');return a.length===b.length&&timingSafeEqual(a,b)}
export function cookie(token,clear=false){return `sm_session=${clear?'':token}; HttpOnly; SameSite=Strict; Path=/; ${process.env.NODE_ENV==='production'?'Secure; ':''}Max-Age=${clear?0:604800}`}
export function tokenFrom(req){return /(?:^|;\s*)sm_session=([^;]+)/.exec(req.headers.cookie||'')?.[1]||''}
