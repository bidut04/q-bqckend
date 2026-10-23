import bcrypt from "bcrypt";
const SALT_LENGTH = 12;

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, SALT_LENGTH);
};

export const verifyPassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
};