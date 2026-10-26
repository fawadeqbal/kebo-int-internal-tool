import { z } from "zod";

const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(["admin", "manager", "staff"]),
  password,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(["admin", "manager", "staff"]),
});

export const resetPasswordSchema = z.object({ password });

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
