import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { api, mapLicenseStatus, type BackendLicenseStatus } from "./api";

const backendStatus: BackendLicenseStatus = {
  mode: "enforced",
  state: "licensed",
  licensed: true,
  plan: "lifetime",
  licenseId: "lic_123",
  subject: "customer@example.com",
  kid: "key-1",
  issuedAt: 1_767_225_600,
  expiresAt: 1_769_817_600,
  licenseExpiresAt: null,
  daysRemaining: 30,
  entitlements: ["storyboard", "automation"],
  deviceId: "device-1",
  lastSyncedAt: "2026-01-01T00:00:00.000Z",
  message: "Lisensi Valid.",
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("license API bridge", () => {
  it("maps the Rust `state`/`message` fields to the UI `status`/`error` contract", () => {
    expect(mapLicenseStatus(backendStatus)).toEqual({
      status: "licensed",
      plan: "lifetime",
      licenseId: "lic_123",
      expiresAt: "2026-01-31T00:00:00.000Z",
      licenseExpiresAt: null,
      entitlements: ["storyboard", "automation"],
      deviceId: "device-1",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
      error: null,
    });
  });

  it("surfaces `message` as an error only when the backend state is error", () => {
    expect(
      mapLicenseStatus({
        ...backendStatus,
        state: "error",
        licensed: false,
        message: "Kunci Publik Lisensi Tidak Valid",
      }),
    ).toMatchObject({
      status: "error",
      error: "Kunci Publik Lisensi Tidak Valid",
    });

    expect(
      mapLicenseStatus({
        ...backendStatus,
        state: "unlinked",
        licensed: false,
        message: "Tautkan Lisensi Dengan Kode Paring Dari Akun BITS.",
      }),
    ).toMatchObject({
      status: "unlinked",
      error: null,
    });
  });

  it("keeps the open-mode licensed state usable", () => {
    expect(
      mapLicenseStatus({
        ...backendStatus,
        mode: "open",
        state: "licensed",
        message: "Build pengembangan ini tidak digerbang lisensi.",
      }),
    ).toMatchObject({ status: "licensed", error: null });
  });

  it("maps every license command through the adapter", async () => {
    invokeMock.mockResolvedValue(backendStatus);

    await expect(api.getLicenseState()).resolves.toMatchObject({ status: "licensed" });
    await expect(api.linkLicenseCode("ABCD1234")).resolves.toMatchObject({ status: "licensed" });
    await expect(api.refreshLicense()).resolves.toMatchObject({ status: "licensed" });
    await expect(api.unlinkLicense()).resolves.toMatchObject({ status: "licensed" });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "license_state", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "license_link_code", { code: "ABCD1234" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "license_refresh", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(4, "license_unlink", undefined);
  });
});
