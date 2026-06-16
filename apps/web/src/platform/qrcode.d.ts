declare module "qrcode" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export type QRCodeModel = {
    modules: {
      size: number;
      data: boolean[];
    };
  };

  const QRCodeEncoder: {
    create: (
      value: string,
      options?: { errorCorrectionLevel?: ErrorCorrectionLevel },
    ) => QRCodeModel;
  };

  export default QRCodeEncoder;
}
