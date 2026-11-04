import Link from "next/link";

export default function NotFound() {
  return (
    <section>
      <h1>No encontramos esa página</h1>
      <p className="lede">El enlace no coincide con ninguna pantalla.</p>
      <p>
        <Link href="/gastos/">Ir a Gastos</Link>
      </p>
    </section>
  );
}
