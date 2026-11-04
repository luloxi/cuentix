#!/usr/bin/env node
/**
 * Datos de DEMO 100% ficticios para correr Tarask en local (wrangler dev) y sacar capturas.
 * Escribe SQL a stdout. Nunca toca producción: aplicalo solo con `wrangler d1 execute DB --local`.
 *
 *   node scripts/seed-demo.mjs > /tmp/demo.sql
 *   cookie de sesión local: tarask_session=demo-session-token
 */
import { createHash } from "node:crypto";

const esc = (s) => String(s).replaceAll("'", "''");
const q = (s) => (s == null ? "NULL" : `'${esc(s)}'`);
const now = Date.now();
const today = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const monthStart = (back) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));

const U = "demo-user-1";
const U2 = "demo-user-2";
const H_PERSONAL = "demo-hh-personal";
const H_CASA = "demo-hh-casa";
const token = "demo-session-token";
const tokenHash = createHash("sha256").update(token).digest("hex");

const cats = [
  ["supermercado", "Supermercado"], ["kiosco", "Kiosco"], ["delivery", "Delivery"],
  ["transporte", "Transporte"], ["restaurante", "Restaurante"], ["streaming", "Streaming"],
  ["salud", "Salud"], ["alquiler", "Alquiler"], ["luz", "Luz"], ["internet", "Internet"],
  ["gas", "Gas"], ["ropa", "Ropa"], ["software", "Software"], ["mascotas", "Mascotas"],
  ["uncategorized", "Sin categoría"],
];
const out = [];
out.push("PRAGMA foreign_keys = ON;");
out.push(`INSERT INTO auth_user (id,name,email,email_verified) VALUES (${q(U)},'Lucía Demo','lucia.demo@example.com',1),(${q(U2)},'Mateo Demo','mateo.demo@example.com',1);`);
out.push(`INSERT INTO users (id,name,email) VALUES (${q(U)},'Lucía Demo','lucia.demo@example.com'),(${q(U2)},'Mateo Demo','mateo.demo@example.com');`);
out.push(`INSERT INTO auth_session (id,expires_at,token,user_id) VALUES ('demo-sess',${now + 30 * 86400000},${q(tokenHash)},${q(U)});`);
out.push(`INSERT INTO households (id,name,invite_code) VALUES (${q(H_PERSONAL)},'Mi espacio','DEMO-0001'),(${q(H_CASA)},'Casa','DEMO-0002');`);
out.push(`INSERT INTO household_members (household_id,user_id,role,display_name) VALUES (${q(H_PERSONAL)},${q(U)},'owner','Lucía'),(${q(H_CASA)},${q(U)},'owner','Lucía'),(${q(H_CASA)},${q(U2)},'member','Mateo');`);
for (const [slug, name] of cats) {
  out.push(`INSERT INTO categories (id,slug,name,kind,default_ownership,is_system) VALUES ('cat-${slug}',${q(slug)},${q(name)},'expense','personal',1);`);
}

let n = 0;
function tx(hh, date, desc, ars, slug, ownership = "personal", extra = {}) {
  n++;
  const fp = `demo-${n}`;
  out.push(
    `INSERT INTO transactions (id,household_id,date,description_raw,description_normalized,amount_ars,amount_usd,category_id,ownership,paid_by_user_id,external_fingerprint,source,bank,card_last4) VALUES ('tx-${n}',${q(hh)},${q(date)},${q(desc)},${q(desc.toUpperCase())},${ars == null ? "NULL" : q(ars.toFixed(2))},${extra.usd != null ? q(extra.usd.toFixed(2)) : "NULL"},'cat-${slug}',${q(ownership)},${q(U)},${q(fp)},'bbva_import','BBVA','4242');`,
  );
}

const spend = [
  ["Coto Palermo", 38400, "supermercado"], ["Carrefour Express", 21250, "supermercado"],
  ["Kiosco Don Pepe", 4800, "kiosco"], ["PedidosYa", 15900, "delivery"],
  ["Uber", 6200, "transporte"], ["SUBE recarga", 10000, "transporte"],
  ["La Parrilla de Juan", 28700, "restaurante"], ["Netflix", 9990, "streaming"],
  ["Spotify", 4199, "streaming"], ["Farmacity", 13450, "salud"],
  ["Día Supermercado", 17800, "supermercado"], ["Rappi", 11300, "delivery"],
  ["Zara", 45900, "ropa"], ["Veterinaria Pelusa", 12600, "mascotas"],
  ["GitHub", 3900, "software"], ["Cabify", 5400, "transporte"],
];
for (let back = 0; back <= 5; back++) {
  const start = monthStart(back);
  const maxDay = back === 0 ? Math.max(1, today.getUTCDate()) : 27;
  spend.forEach(([desc, base, slug], i) => {
    if (back === 0 && i > 8) return; // mes en curso: menos movimientos
    const day = Math.min(maxDay, 1 + ((i * 3 + back) % 26));
    const factor = 1 + ((i + back) % 5) * 0.06;
    tx(H_PERSONAL, ymd(addDays(start, day - 1)), desc, Math.round(base * factor), slug);
  });
  // gastos compartidos del hogar
  tx(H_CASA, ymd(addDays(start, 0)), "Alquiler depto", 420000, "alquiler", "shared");
  tx(H_CASA, ymd(addDays(start, 4)), "Edesur luz", 28600 + back * 900, "luz", "shared");
  tx(H_CASA, ymd(addDays(start, 6)), "Fibertel internet", 23500, "internet", "shared");
  tx(H_CASA, ymd(addDays(start, 9)), "Metrogas", 15200 + back * 500, "gas", "shared");
  tx(H_CASA, ymd(addDays(start, 11)), "Coto compra grande", 61200 + back * 1500, "supermercado", "shared");
}
// los gastos del hogar también cuentan en el espacio personal vía ownership shared del hogar Casa

// ingresos
for (let back = 0; back <= 5; back++) {
  const start = monthStart(back);
  out.push(`INSERT INTO incomes (id,user_id,household_id,kind,frequency,date,label,amount_ars,amount_usd) VALUES ('inc-sal-${back}',${q(U)},${q(H_PERSONAL)},'fixed','monthly',${q(ymd(addDays(start, 1)))},'Sueldo','1250000',NULL);`);
  if (back % 2 === 0) out.push(`INSERT INTO incomes (id,user_id,household_id,kind,frequency,date,label,amount_ars,amount_usd) VALUES ('inc-fr-${back}',${q(U)},${q(H_PERSONAL)},'variable',NULL,${q(ymd(addDays(start, 14)))},'Trabajo freelance',NULL,'450');`);
}

// ahorros
out.push(`INSERT INTO savings_assets (id,user_id,household_id,kind,label,amount_ars,amount_usd) VALUES ('sv-1',${q(U)},${q(H_PERSONAL)},'bank','Caja de ahorro','1840000','1200'),('sv-2',${q(U)},${q(H_PERSONAL)},'bank','Cuenta sueldo','320000',NULL);`);
out.push(`INSERT INTO savings_assets (id,user_id,household_id,kind,label,address,last_balance_usd) VALUES ('sv-3',${q(U)},${q(H_PERSONAL)},'evm','Wallet EVM','0x0000000000000000000000000000000000000001','850');`);
// deuda
out.push(`INSERT INTO debt_settings (user_id,force_settled,card_last4,saldo_deuda_ars,saldo_deuda_usd,rate_pct,min_payment_ars,due_day) VALUES (${q(U)},0,'4242','612000','0','70','48000',12);`);

// patrimonio: una serie diaria de ~7 meses con tendencia alcista
for (let i = 200; i >= 0; i -= 4) {
  const d = ymd(addDays(today, -i));
  const t = (200 - i) / 200;
  const fx = 1250 + t * 310;
  const assetsArs = Math.round(1500000 + t * 660000 + Math.sin(i / 9) * 60000);
  const assetsUsd = Math.round(1500 + t * 550);
  const debtArs = Math.round(950000 - t * 338000 + Math.cos(i / 7) * 30000);
  out.push(`INSERT INTO patrimonio_snapshots (id,user_id,date,assets_ars,assets_usd,debt_ars,debt_usd,net_worth_ars,fx_rate,source) VALUES ('ps-${i}',${q(U)},${q(d)},${q(assetsArs + assetsUsd * fx)},${q(assetsUsd)},${q(debtArs)},'0',${q(assetsArs + assetsUsd * fx - debtArs)},${q(fx)},'snapshot');`);
}
console.log(out.join("\n"));
