import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart,
  Store,
  Bike,
  Car,
  UtensilsCrossed,
  IceCream,
  Bot,
  Server,
  AppWindow,
  Wifi,
  Clapperboard,
  HeartPulse,
  Shirt,
  PawPrint,
  Share2,
  HelpCircle,
  CreditCard,
  Percent,
  Package,
  Home,
  Zap,
  Droplets,
  Flame,
  Router,
  ArrowLeftRight,
  CandlestickChart,
  Sparkles,
  Send,
  Cpu,
  Calendar,
  Flower2,
  Armchair,
  Building2,
} from "lucide-react";

/** Icon per category slug — inventory-style markers for fast visual scan. */
const ICONS: Record<string, LucideIcon> = {
  supermercado: ShoppingCart,
  kiosco: Store,
  delivery: Bike,
  transporte: Car,
  restaurante: UtensilsCrossed,
  heladeria: IceCream,
  "ia-tech": Bot,
  hosting: Server,
  software: AppWindow,
  telecom: Wifi,
  streaming: Clapperboard,
  salud: HeartPulse,
  ropa: Shirt,
  mascotas: PawPrint,
  redes: Share2,
  uncategorized: HelpCircle,
  pagos: CreditCard,
  "intereses-cargos": Percent,
  conversiones: ArrowLeftRight,
  "crypto-inversiones": CandlestickChart,
  rendimientos: Sparkles,
  envios: Send,
  alquiler: Home,
  luz: Zap,
  agua: Droplets,
  gas: Flame,
  internet: Router,
  expensas: Building2,
  "herramientas-ai": Bot,
  "infra-cloud": Server,
  "eventos-extras": Calendar,
  movilidad: Car,
  hardware: Cpu,
  jardineria: Flower2,
  "muebles-arreglos": Armchair,
};

export function iconForCategory(slug: string | null | undefined): LucideIcon {
  if (!slug) return Package;
  return ICONS[slug] ?? Package;
}

export function CategoryIcon({
  slug,
  className,
  size = 16,
}: {
  slug: string | null | undefined;
  className?: string;
  size?: number;
}) {
  const Icon = iconForCategory(slug);
  return <Icon className={className} size={size} strokeWidth={2} />;
}
