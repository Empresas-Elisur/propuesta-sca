// Tasa del día de la propuesta: consulta la conversión de referencia de USD a CLP y la UF del día (tabla anual del
// SII) y escribe tasa.json, que la página lee al abrirse para mostrar los montos en pesos. Cada valor se valida por
// separado: si una consulta falla o da un valor no razonable, ese valor queda como estaba, el otro se actualiza y el
// script termina con error para que el workflow quede marcado (la página sigue con el valor anterior).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FUENTE_USD = "https://www.binance.com/bapi/asset/v1/public/asset-service/product/currency";
const FUENTE_UF = (anio) => `https://www.sii.cl/valores_y_fechas/uf/uf${anio}.htm`;
const USD = { min: 700, max: 1300, variacion: 0.05 };
const UF = { min: 30000, max: 60000, variacion: 0.03 };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const anterior = existsSync("tasa.json") ? JSON.parse(readFileSync("tasa.json", "utf8")) : {};
const errores = [];

function validar(nombre, valor, limites, previo) {
  if (!(valor >= limites.min && valor <= limites.max)) throw new Error(`${nombre} fuera de rango: ${valor}`);
  if (previo && Math.abs(valor / previo - 1) > limites.variacion)
    throw new Error(`${nombre}: variación mayor a ${limites.variacion * 100} % frente al valor anterior (${previo})`);
  return valor;
}

async function dolar() {
  const r = await fetch(FUENTE_USD, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`la fuente del dólar respondió ${r.status}`);
  const par = ((await r.json()).data || []).find((x) => x.pair === "CLP_USD");
  return validar("dólar", Number(par?.rate), USD, anterior.valor);
}

/* la tabla del SII trae un bloque por mes (id mes_octubre) con pares día / valor, por ejemplo 41.231,70 */
async function uf() {
  const [anio, mes, dia] = hoy.split("-").map(Number);
  const r = await fetch(FUENTE_UF(anio));
  if (!r.ok) throw new Error(`la tabla del SII respondió ${r.status}`);
  const html = await r.text();
  const ini = html.search(new RegExp(`id=["']mes_${MESES[mes - 1]}["']`));
  if (ini < 0) throw new Error(`la tabla del SII no trae el mes de ${MESES[mes - 1]}`);
  const fin = html.indexOf("class='meses'", ini + 20);
  const bloque = html.slice(ini, fin < 0 ? undefined : fin);
  for (const m of bloque.matchAll(/<strong>\s*(\d{1,2})\s*<\/strong>\s*<\/th>\s*<td[^>]*>\s*([\d.]+,\d{2})\s*<\/td>/g))
    if (Number(m[1]) === dia) return validar("UF", Number(m[2].replace(/\./g, "").replace(",", ".")), UF, anterior.uf?.valor);
  throw new Error(`la tabla del SII no trae la UF del ${hoy}`);
}

const nuevo = { fecha: anterior.fecha, valor: anterior.valor, uf: anterior.uf };
try { nuevo.valor = await dolar(); nuevo.fecha = hoy; } catch (e) { errores.push(e.message); }
try { nuevo.uf = { fecha: hoy, valor: await uf() }; } catch (e) { errores.push(e.message); }

if (nuevo.fecha === anterior.fecha && nuevo.valor === anterior.valor && nuevo.uf?.valor === anterior.uf?.valor && nuevo.uf?.fecha === anterior.uf?.fecha) {
  console.log("Sin valores nuevos");
} else {
  writeFileSync("tasa.json", JSON.stringify({ ...nuevo, obtenido: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Dólar del ${nuevo.fecha}: ${nuevo.valor} · UF del ${nuevo.uf?.fecha}: ${nuevo.uf?.valor}`);
}
if (errores.length) {
  console.error(errores.join("\n"));
  process.exit(1);
}
