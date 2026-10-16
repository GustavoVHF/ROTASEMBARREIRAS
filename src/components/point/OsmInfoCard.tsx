"use client";

import React from "react";
import type { TouristPoint } from "@/types/point";
import { formatOpeningHours, osmValueLabel, phoneHref, websiteLabel } from "@/lib/communityResources";

/** Linhas de texto do card (também usadas na leitura em voz alta). */
export function osmInfoLines(osm: TouristPoint["osm"]): { basic: string[]; community: string[] } {
  const basic: string[] = [];
  const community: string[] = [];
  if (!osm) return { basic, community };
  if (osm.openingHours) basic.push(`Horário: ${formatOpeningHours(osm.openingHours)}`);
  if (osm.phone) basic.push(`Telefone: ${osm.phone}`);
  if (osm.website && /^https?:\/\//i.test(osm.website)) basic.push(`Site: ${websiteLabel(osm.website)}`);
  const wheel = osmValueLabel(osm.wheelchair);
  if (wheel) community.push(`Acesso para cadeira de rodas: ${wheel}`);
  const toilets = osmValueLabel(osm.toiletsWheelchair);
  if (toilets) community.push(`Banheiro acessível: ${toilets}`);
  return { basic, community };
}

/**
 * Dados básicos vindos do OpenStreetMap (horário, telefone, site), rotulados
 * "Fonte: OpenStreetMap". wheelchair / toilets:wheelchair ficam num bloco
 * separado, "Segundo o OpenStreetMap", com peso visual menor e sem ícone de
 * estado — nunca como informação verificada.
 */
export default function OsmInfoCard({ osm }: { osm: TouristPoint["osm"] }) {
  if (!osm) return null;
  const hours = osm.openingHours ? formatOpeningHours(osm.openingHours) : null;
  const website = osm.website && /^https?:\/\//i.test(osm.website) ? osm.website : null;
  const wheel = osmValueLabel(osm.wheelchair);
  const toilets = osmValueLabel(osm.toiletsWheelchair);
  const hasBasic = Boolean(hours || osm.phone || website);
  const hasCommunity = Boolean(wheel || toilets);
  if (!hasBasic && !hasCommunity) return null;

  return (
    <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
      <h3 className="text-lg font-black text-text-main">Fonte: OpenStreetMap</h3>

      {hasBasic && (
        <dl className="mt-4 space-y-3">
          {hours && (
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">Horário</dt>
              <dd className="text-base font-semibold text-text-main mt-0.5">{hours}</dd>
            </div>
          )}
          {osm.phone && (
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">Telefone</dt>
              <dd className="text-base font-semibold mt-0.5">
                <a href={phoneHref(osm.phone)} className="text-text-main underline underline-offset-2">
                  {osm.phone}
                </a>
              </dd>
            </div>
          )}
          {website && (
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">Site</dt>
              <dd className="text-base font-semibold mt-0.5">
                <a href={website} target="_blank" rel="noopener noreferrer" className="text-text-main underline underline-offset-2">
                  {websiteLabel(website)}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {hasCommunity && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-extrabold uppercase text-text-secondary">Segundo o OpenStreetMap</p>
          <ul className="mt-2 space-y-1">
            {wheel && <li className="text-sm text-text-secondary">Acesso para cadeira de rodas: {wheel}</li>}
            {toilets && <li className="text-sm text-text-secondary">Banheiro acessível: {toilets}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
