import {
  categoryHintForFiwindKind,
  classifyFiwindTipo,
  exactFiwindMerchantSlug,
  extractFiwindMerchant,
} from "@/lib/import/fiwind";

export type CategorySeed = {
  slug: string;
  name: string;
  kind: "expense" | "payment" | "interest";
  /** Default ownership when importing */
  defaultOwnership: "personal" | "shared";
  patterns: string[];
  priority: number;
};

/**
 * Canonical categories + merchant patterns derived from Transparencia_Actualizada_Junio2026.
 * Matching is case-insensitive substring on normalized description.
 */
export const CATEGORY_SEEDS: CategorySeed[] = [
  {
    slug: "pagos",
    name: "Pagos",
    kind: "payment",
    defaultOwnership: "personal",
    patterns: ["SU PAGO EN PESOS", "SU PAGO EN USD", "PAGO RECIBIDO", "PAGO EN PESOS"],
    priority: 100,
  },
  {
    slug: "transferencia-interna",
    name: "Transferencia interna",
    kind: "payment",
    defaultOwnership: "personal",
    patterns: [
      "TRANSFERENCIA INTERNA",
      "TRANSFERENCIA ENTRE CUENTAS",
      "TRANSFERENCIA INMEDIATA",
      "TRANSF. CLIENTE",
      "TRANSF CLIENTE",
      "CTA. CAP",
      "CTA CAP",
      "CUENTA PROPIA",
      "CTA A CTA",
      "CUENTA A CUENTA",
      "CUENTA TUYA",
      "CAMBIO DE MONEDA",
      "CAMBIO MONEDA",
      "OPERACION DE CAMBIO",
      "OPERACION CAMBIO",
      "COMPRA ME",
      "VENTA ME",
      "BBNK",
      "MISMO TITULAR",
      // BBVA credit-transfer tickets (Rainman: $300k CR TBE/TRF INM COE)
      "CR TRF",
      "CR TBE",
      "INM COE",
    ],
    priority: 99,
  },
  {
    slug: "intereses-cargos",
    name: "Intereses / Cargos Bancarios",
    kind: "interest",
    defaultOwnership: "personal",
    patterns: [
      "INTERESES",
      "CARGOS BANCARIOS",
      "CREDITO/DEBITO VEP",
      "PERC. IB",
      "IVA SERV.DIGITAL",
      "IVA SERV. DIGITAL",
      "CR.RG",
      "CREDENCIAL Y URBANA",
      // Accounting lines (excluded from “gastos” totals via isBankAccountingEntry)
      "PESIFICACION",
      "PESIFICACIÓN",
      "TRANSFERENCIA DEUDA",
      "CREDITOS VS EN USD",
    ],
    priority: 90,
  },
  {
    slug: "conversiones",
    name: "Conversiones",
    kind: "interest",
    defaultOwnership: "personal",
    patterns: [
      "CONVERSIÓN",
      "CONVERSION",
      "TRANSFERENCIA ARS",
      "TRANSFERENCIA USDC",
      "TRANSFERENCIA USDT",
      "TRANSFERENCIA USD",
    ],
    priority: 95,
  },
  {
    slug: "crypto-inversiones",
    name: "Crypto / inversiones",
    kind: "interest",
    defaultOwnership: "personal",
    patterns: ["COMPRA KO", "VENTA KO"],
    priority: 95,
  },
  {
    slug: "rendimientos",
    name: "Rendimientos",
    kind: "interest",
    defaultOwnership: "personal",
    patterns: ["GANANCIA DIARIA", "RENDIMIENTO BONIFICADO"],
    priority: 95,
  },
  {
    slug: "envios",
    name: "Envíos",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: ["RETIRO A "],
    priority: 40,
  },
  {
    slug: "alquiler",
    name: "Alquiler",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["ALQUILER", "RENTA", "RENT "],
    priority: 88,
  },
  {
    slug: "luz",
    name: "Luz / Electricidad",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: [
      "EDENOR",
      "EDESUR",
      "EDELAP",
      "EDEUR",
      "LUZ",
      "ELECTRICIDAD",
      "EDEN",
    ],
    priority: 85,
  },
  {
    slug: "agua",
    name: "Agua",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["AYSA", "AGUA", "AGUAS ARGENTINAS", "AGUAS DEL"],
    priority: 85,
  },
  {
    slug: "gas",
    name: "Gas",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["METROGAS", "NATURGY", "CAMUZZI", "GAS NATURAL", "GAS "],
    priority: 85,
  },
  {
    slug: "internet",
    name: "Internet",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: [
      "TELECENTRO",
      "FIBERTEL",
      "PERSONAL FIBRA",
      "CLARO INTERNET",
      "MOVISTAR FIBRA",
      "INTERNET",
      "FIBRA",
      "CABLEVISION",
    ],
    priority: 82,
  },
  {
    slug: "expensas",
    name: "Expensas",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["EXPENSAS", "EXPENSA ", "ABL ", "ABL-", "TASA MUNICIPAL"],
    priority: 84,
  },
  {
    slug: "supermercado",
    name: "Supermercado",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: [
      "DIA TIENDA",
      "PAGO A DIA",
      "COMPRA SUPER",
      "COTO",
      "EXPRESS AV",
      "SUPERCHANGO",
      "SUPER RAFAELA",
      "I FRESH MARKET",
      "CARREFOUR",
      "JUMBO",
      "DISCO",
      "VEA ",
      "CHANGOMAS",
      "DIA %",
    ],
    priority: 80,
  },
  {
    slug: "kiosco",
    name: "Kiosco / Minimarket",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["KIOSCO", "MAXIKIOSCO", "MINIMARKET", "AUTOSERVICIO"],
    priority: 75,
  },
  {
    slug: "delivery",
    name: "Delivery",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["RAPPI", "PROPINA*RAPPI", "RAPPIPRO", "PEDIDOSYA", "MP*PEDIDOSYA"],
    priority: 80,
  },
  {
    slug: "transporte",
    name: "Transporte",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: [
      "PAYU*AR*UBER",
      "UBER",
      "CABIFY",
      "DIDI",
      "TEMBICI",
      "SUBE",
      "BA MOVILIDAD",
      "YPF",
      "SHELL",
      "AXION",
    ],
    priority: 70,
  },
  {
    slug: "restaurante",
    name: "Restaurante",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: [
      "RESTAURANT",
      "RESTO",
      "KENTUCKY",
      "AVANT GARTEN",
      "PANADERIA",
      "HAVANNA",
      "THE BURGER",
      "WHOOPIES",
      "LA CASA DEL DULCE",
      "HELADOS",
    ],
    priority: 60,
  },
  {
    slug: "heladeria",
    name: "Heladería",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["HELADO", "FREDDO", "GRIDO"],
    priority: 65,
  },
  {
    slug: "ia-tech",
    name: "IA / Tecnología",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: [
      "OPENAI",
      "CHATGPT",
      "CLAUDE.AI",
      "ANTHROPIC",
      "OPENROUTER",
      "GROK",
      "XAI",
      "CURSOR",
      "GITHUB COPILOT",
    ],
    priority: 85,
  },
  {
    slug: "hosting",
    name: "Hosting / Tecnología",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: [
      "VERCEL",
      "RAILWAY",
      "DIGITALOCEAN",
      "GOOGLE ONE",
      "AWS",
      "CLOUDFLARE",
      "NETLIFY",
      "HEROKU",
      "SUPABASE",
      "NEON",
    ],
    priority: 80,
  },
  {
    slug: "software",
    name: "Software / Tecnología",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: ["GOOGLE CHROME", "MICROSOFT", "ADOBE", "NOTION", "FIGMA", "1PASSWORD"],
    priority: 70,
  },
  {
    slug: "telecom",
    name: "Telecomunicaciones",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["PERSONAL", "MOVISTAR", "CLARO", "TELECENTRO", "FIBERTEL", "DIRECTV"],
    priority: 70,
  },
  {
    slug: "streaming",
    name: "Streaming / Entretenimiento",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: [
      "NETFLIX",
      "SPOTIFY",
      "DISNEY",
      "HBO",
      "MAX.COM",
      "YOUTUBE",
      "PRIME VIDEO",
      "APPLE.COM/BILL",
      "STEAM",
      "PLAYSTATION",
      "X CORP",
      "TWITTER",
    ],
    priority: 70,
  },
  {
    slug: "salud",
    name: "Salud / Farmacia",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["FARMACITY", "FARMACITY", "DR AHUMADA", "SIMPLICITY", "OSDE", "SWISS MEDICAL"],
    priority: 70,
  },
  {
    slug: "ropa",
    name: "Ropa / Calzado",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: ["MACOWENS", "NIKE", "MOOV", "ZARA", "H&M", "ADIDAS", "FALABELLA"],
    priority: 60,
  },
  {
    slug: "mascotas",
    name: "Veterinaria / Mascotas",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["VETERINAR", "PETSHOP", "PUPPIS", "MERCADOLIBRE*PET"],
    priority: 60,
  },
  {
    slug: "redes",
    name: "Redes Sociales",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: ["META ", "FACEBK", "INSTAGRAM", "TIKTOK"],
    priority: 60,
  },
  {
    slug: "jardineria",
    name: "Jardinería",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["JARDIN", "VIVERO", "JARDINER"],
    priority: 55,
  },
  {
    slug: "muebles-arreglos",
    name: "Muebles / Arreglos de la casa",
    kind: "expense",
    defaultOwnership: "shared",
    patterns: ["MUEBLER", "SODIMAC", "EASY ", "REX ", "FERRETER"],
    priority: 55,
  },
  {
    slug: "uncategorized",
    name: "Uncategorized",
    kind: "expense",
    defaultOwnership: "personal",
    patterns: [],
    priority: 0,
  },
];

export type CategoryMatch = {
  slug: string;
  name: string;
  kind: CategorySeed["kind"];
  defaultOwnership: "personal" | "shared";
};

function matchAgainst(text: string): CategoryMatch | null {
  const u = text.toUpperCase();
  const sorted = [...CATEGORY_SEEDS].sort((a, b) => b.priority - a.priority);
  for (const cat of sorted) {
    for (const p of cat.patterns) {
      if (p.includes("%")) {
        const [prefix] = p.split("%");
        if (u.includes(prefix.toUpperCase())) {
          return {
            slug: cat.slug,
            name: cat.name,
            kind: cat.kind,
            defaultOwnership: cat.defaultOwnership,
          };
        }
      } else if (u.includes(p.toUpperCase())) {
        return {
          slug: cat.slug,
          name: cat.name,
          kind: cat.kind,
          defaultOwnership: cat.defaultOwnership,
        };
      }
    }
  }
  return null;
}

export function matchCategory(description: string): CategoryMatch {
  const uncategorized: CategoryMatch = {
    slug: "uncategorized",
    name: "Uncategorized",
    kind: "expense",
    defaultOwnership: "personal",
  };

  const exactSlug = exactFiwindMerchantSlug(description);
  if (exactSlug) {
    const cat = CATEGORY_SEEDS.find((c) => c.slug === exactSlug);
    if (cat) {
      return {
        slug: cat.slug,
        name: cat.name,
        kind: cat.kind,
        defaultOwnership: cat.defaultOwnership,
      };
    }
  }

  const merchant = extractFiwindMerchant(description);
  const hit =
    matchAgainst(description) ??
    (merchant !== description ? matchAgainst(merchant) : null);
  if (hit) return hit;

  const fiwindHint = categoryHintForFiwindKind(
    classifyFiwindTipo(description),
  );
  if (fiwindHint) {
    const cat = CATEGORY_SEEDS.find((c) => c.slug === fiwindHint);
    if (cat) {
      return {
        slug: cat.slug,
        name: cat.name,
        kind: cat.kind,
        defaultOwnership: cat.defaultOwnership,
      };
    }
  }

  return uncategorized;
}

/** Normalize legacy Transparencia category names to slugs */
export function categoryNameToSlug(name: string): string {
  const n = name.trim().toLowerCase();
  const map: Record<string, string> = {
    supermercado: "supermercado",
    "supermercado / alimentos": "supermercado",
    "kiosco / minimarket": "kiosco",
    delivery: "delivery",
    "delivery / rappi": "delivery",
    transporte: "transporte",
    "transporte / uber": "transporte",
    "transporte / bicicleta": "transporte",
    restaurante: "restaurante",
    "restaurante / comida": "restaurante",
    heladería: "heladeria",
    heladeria: "heladeria",
    "ia / tecnología": "ia-tech",
    "ia / tecnologia": "ia-tech",
    "hosting / tecnología": "hosting",
    "hosting / tecnologia": "hosting",
    "software / tecnología": "software",
    "software / tecnologia": "software",
    "suscripciones / software": "software",
    telecomunicaciones: "telecom",
    "streaming / entretenimiento": "streaming",
    "salud / farmacia": "salud",
    "ropa / calzado": "ropa",
    "veterinaria / mascotas": "mascotas",
    "redes sociales": "redes",
    "intereses / cargos bancarios": "intereses-cargos",
    "cuotas / financiación": "uncategorized",
    "cuotas / financiacion": "uncategorized",
    uncategorized: "uncategorized",
    "hogar / servicios": "uncategorized",
    videojuegos: "streaming",
    "herramientas ai": "herramientas-ai",
    "infra y cloud": "infra-cloud",
    "eventos y extras": "eventos-extras",
    movilidad: "movilidad",
    hardware: "hardware",
    alquiler: "alquiler",
    conversiones: "conversiones",
    "crypto / inversiones": "crypto-inversiones",
    "crypto-inversiones": "crypto-inversiones",
    rendimientos: "rendimientos",
    envíos: "envios",
    envios: "envios",
    luz: "luz",
    "luz / electricidad": "luz",
    agua: "agua",
    gas: "gas",
    internet: "internet",
  };
  return map[n] ?? "uncategorized";
}