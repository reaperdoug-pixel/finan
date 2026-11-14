import { hash, verify } from "@node-rs/argon2";

export const SENHA_MIN = 10;
export const SENHA_MAX = 128;

/** Devolve a mensagem de erro, ou null se a senha é aceitável. */
export function validarSenha(senha: string): string | null {
  if (senha.length < SENHA_MIN) return `A senha deve ter pelo menos ${SENHA_MIN} caracteres`;
  if (senha.length > SENHA_MAX) return `A senha deve ter no máximo ${SENHA_MAX} caracteres`;
  return null;
}

/** argon2id com os parâmetros padrão da biblioteca (m=19456 KiB, t=2, p=1: recomendação OWASP). */
export function gerarHash(senha: string): Promise<string> {
  return hash(senha);
}

export async function conferirSenha(hashGuardado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha);
  } catch {
    return false;
  }
}

let hashFalso: Promise<string> | undefined;

/**
 * Hash descartável usado quando o e-mail não existe, para gastar o mesmo tempo
 * de um login real e não revelar quais e-mails estão cadastrados.
 */
export function hashDescartavel(): Promise<string> {
  hashFalso ??= gerarHash("senha-descartavel-para-igualar-tempo");
  return hashFalso;
}
