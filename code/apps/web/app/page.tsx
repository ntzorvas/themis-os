// Σελίδα "coming soon" — placeholder μέχρι Day 2
// Αντικαθίσταται από το landing + auth flow (Day 4)

const productName = process.env['PRODUCT_NAME'] ?? 'ΘΕΜΙΣ OS';
const productSlug = process.env['PRODUCT_SLUG'] ?? 'themisos';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary-900 p-8">
      <div className="max-w-md text-center">
        {/* Logo placeholder */}
        <div
          className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-legal-gold"
          aria-hidden="true"
        >
          <span className="text-3xl font-bold text-primary-900">Λ</span>
        </div>

        <h1 className="mb-4 text-4xl font-bold tracking-tight text-white">
          {productName}
        </h1>

        <p className="mb-2 text-lg text-gray-300">
          Λογισμικό Διαχείρισης Δικηγορικού Γραφείου
        </p>

        <p className="text-sm text-gray-500">
          Σύντομα διαθέσιμο — {productSlug}.gr
        </p>

        {/* Status badge */}
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary-700 px-4 py-2">
          <span
            className="h-2 w-2 rounded-full bg-green-400"
            aria-hidden="true"
          />
          <span className="text-sm text-gray-200">
            Ανάπτυξη σε εξέλιξη — Day 1
          </span>
        </div>
      </div>
    </main>
  );
}
