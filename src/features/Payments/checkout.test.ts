import { describe, expect, it, vi } from 'vitest';

import { submitPaymentCheckout } from './checkout';

describe('submitPaymentCheckout', () => {
  it('submits only the structured hidden fields returned by the server', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    submitPaymentCheckout({
      fields: { method: 'alipay.trade.page.pay', sign: 'signed' },
      method: 'POST',
      type: 'form',
      url: 'https://openapi.alipay.com/gateway.do',
    });

    const form = document.body.querySelector(
      'form[action="https://openapi.alipay.com/gateway.do"]',
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(form).toHaveAttribute('method', 'post');
    expect(form?.querySelector('input[name="sign"]')).toHaveAttribute('value', 'signed');
    expect(form?.children).toHaveLength(2);
    form?.remove();
  });

  it('rejects executable or credential-bearing checkout URLs', () => {
    expect(() =>
      submitPaymentCheckout({
        fields: { sign: 'signed' },
        method: 'POST',
        type: 'form',
        url: 'javascript:alert(1)',
      }),
    ).toThrow('invalid_payment_checkout_url');
    expect(() =>
      submitPaymentCheckout({
        type: 'redirect',
        url: 'https://user:password@pay.example.com',
      }),
    ).toThrow('invalid_payment_checkout_url');
  });
});
