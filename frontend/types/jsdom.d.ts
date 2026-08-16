declare module "jsdom" {
  export class JSDOM {
    window: {
      document: Document;
    };

    constructor(
      html?: string,
      options?: { url?: string }
    );
  }
}
