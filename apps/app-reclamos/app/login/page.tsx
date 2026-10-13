import Image from 'next/image';
import { login } from './actions';

const ERROR_MSG: Record<string, string> = {
  input: 'Datos inválidos.',
  credentials: 'Email o contraseña incorrectos.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const message = error ? ERROR_MSG[error] ?? 'Error al ingresar.' : null;
  return (
    <div className="page-bg page-bg-login min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/shimano-logo.png"
            alt="Shimano"
            width={160}
            height={46}
            priority
            className="h-9 w-auto mb-6 drop-shadow-[0_2px_16px_rgba(0,0,0,0.35)]"
          />
          <h1 className="display text-2xl text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.5)]">
            Reclamos
          </h1>
          <p className="text-sm text-white/80 mt-1 drop-shadow-[0_1px_8px_rgba(0,0,0,0.4)]">
            Ingresá para gestionar tus tarjetas
          </p>
        </div>
        <form
          action={login}
          className="sheet-panel p-7 space-y-4"
        >
          {message && (
            <p
              role="alert"
              className="text-sm rounded-[10px] px-3.5 py-2.5 bg-[#FFF0F0] text-[#C7301B]"
            >
              {message}
            </p>
          )}
          <input type="hidden" name="next" value={next ?? ''} />
          <label className="block">
            <span className="text-xs font-medium tracking-tight text-[color:var(--text-secondary)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field mt-1.5"
              placeholder="tu@correo.com"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium tracking-tight text-[color:var(--text-secondary)]">
              Contraseña
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="field mt-1.5"
              placeholder="••••••••"
            />
          </label>
          <button type="submit" className="pill-primary w-full justify-center mt-2">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}
