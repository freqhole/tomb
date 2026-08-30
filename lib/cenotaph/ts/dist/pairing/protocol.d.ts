import { z } from "zod";
export declare const PairRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"pair_request">;
    pin: z.ZodString;
    display_name: z.ZodString;
}, z.core.$strip>;
export type PairRequest = z.infer<typeof PairRequestSchema>;
export declare const PairResponseSchema: z.ZodObject<{
    type: z.ZodLiteral<"pair_response">;
    ok: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodEnum<{
        invalid_pin: "invalid_pin";
        rate_limited: "rate_limited";
    }>>;
}, z.core.$strip>;
export type PairResponse = z.infer<typeof PairResponseSchema>;
//# sourceMappingURL=protocol.d.ts.map