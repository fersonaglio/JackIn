'use client';
import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useCatalog } from '@/hooks/useCatalog';
import CategoryRow from './CategoryRow';
import SearchBar from './SearchBar';
import HeroBanner from './HeroBanner';
import type { CatalogItem } from '@/types/media';
import type { Project } from '@/lib/api';
import { buildBackdropUrl } from '@/data/media';

interface MediaCatalogProps {
  onSelectItem: (item: CatalogItem) => void;
  onSelectPt?: (item: CatalogItem) => void;
  libraryCount?: number;
  projects?: Project[];
  onWatchProject?: (project: Project) => void;
  children?: ReactNode;
}

export default function MediaCatalog({
  onSelectItem,
  onSelectPt,
  libraryCount = 0,
  projects = [],
  onWatchProject,
  children,
}: MediaCatalogProps) {
  const { data, loading } = useCatalog();

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse p-4">
        <div className="h-16 rounded-xl bg-zinc-900" />
        <div className="h-[300px] rounded-2xl bg-zinc-900" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-48 rounded bg-zinc-900" />
            <div className="flex gap-4">
              {[1, 2, 3, 4, 5, 6].map((j) => (
                <div key={j} className="w-[160px] aspect-[2/3] rounded-lg bg-zinc-900 shrink-0" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const filmes = data.popularMovies.slice(0, 12);
  const series = data.trendingTV.slice(0, 8);
  const destaques = filmes.slice(3, 6);

  const doneProjects = projects.filter((p) => p.status === 'done');
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  const downloadedBannerItems: CatalogItem[] = doneProjects.map((p) => ({
    tmdbId: p.id as any,
    title: p.title || 'Mídia Baixada',
    overview: 'Disponível para assistir em 4K Full HD na sua biblioteca JackIn.',
    posterPath: `${apiBase}/projects/${p.id}/thumbnail`,
    backdropPath: `${apiBase}/projects/${p.id}/thumbnail`,
    year: 2024,
    rating: 9.8,
    genres: ['Biblioteca P2P'],
    type: p.projectType === 'movie' ? 'movie' : 'tv',
  }));

  const heroBannerItems = downloadedBannerItems.length > 0
    ? downloadedBannerItems
    : data.trending.slice(0, 5);

  const handleHeroPlay = (item: CatalogItem) => {
    const matchedProj = doneProjects.find((p) => String(p.id) === String(item.tmdbId));
    if (matchedProj && onWatchProject) {
      onWatchProject(matchedProj);
    } else {
      onSelectItem(item);
    }
  };

  return (
    <div className="space-y-10 text-zinc-100 min-h-screen pt-8 pb-16 font-sans">
      {/* Search Bar Row below top navbar */}
      <div className="w-full max-w-3xl mx-auto pb-4">
        <SearchBar />
      </div>

      {/* Big Hero Banner with Top 10 Movies / Series of the moment */}
      {data.trending && data.trending.length > 0 && (
        <div className="w-full mb-6">
          <HeroBanner
            items={data.trending}
            onPlay={handleHeroPlay}
            onMoreInfo={onSelectItem}
          />
        </div>
      )}

      <div className="space-y-12">
        {/* Section: Top 10 do Momento & Lançamentos */}
        {data.trending && data.trending.length > 0 && (
          <CategoryRow
            title="Top 10 do Momento &amp; Lançamentos"
            items={data.trending}
            onSelect={onSelectItem}
            badgeType="lancamento"
            viewAllHref="/filmes"
          />
        )}

        {/* Section 0: Em Português — filmes que têm release dublado PT-BR */}
        {filmes.length > 0 && (
          <CategoryRow
            title="Em Português (Dublado)"
            items={filmes.slice(0, 12)}
            onSelect={onSelectPt || onSelectItem}
            badgeType="dublado"
            viewAllHref="/filmes"
          />
        )}

        {/* Section 1: Últimos Filmes */}
        <CategoryRow
          title="Últimos Filmes"
          items={filmes}
          onSelect={onSelectItem}
          badgeType="dublado"
          viewAllHref="/filmes"
        />

        {/* Section 2: Highlight Wide Banner Cards */}
        {destaques.length >= 3 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">
            {destaques.map((item) => (
              <div
                key={item.tmdbId}
                onClick={() => onSelectItem(item)}
                className="relative h-44 rounded-xl overflow-hidden cursor-pointer group border border-zinc-800/80 shadow-lg"
              >
                <img
                  src={buildBackdropUrl(item.backdropPath || item.posterPath, 'w780')}
                  alt={item.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-between p-4">
                  <div className="flex justify-end">
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-[#E50914] text-white">
                      FILME
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white group-hover:text-[#E50914] transition-colors line-clamp-1">
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{item.year || '2024'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Section 3: Últimas Séries */}
        <CategoryRow
          title="Últimas Séries"
          items={series}
          onSelect={onSelectItem}
          badgeType="legendado"
          viewAllHref="/series"
        />

        {/* Section 4: Ficção Científica & Fantasia */}
        {data.scifi && data.scifi.length > 0 && (
          <CategoryRow
            title="Ficção Científica &amp; Fantasia"
            items={data.scifi}
            onSelect={onSelectItem}
            badgeType="dublado"
            viewAllHref="/filmes?genre=scifi"
          />
        )}

        {/* Section 5: Ação & Aventura em 4K */}
        {data.action && data.action.length > 0 && (
          <CategoryRow
            title="Ação &amp; Aventura em 4K"
            items={data.action}
            onSelect={onSelectItem}
            badgeType="legendado"
            viewAllHref="/filmes?genre=action"
          />
        )}

        {/* Section 6: Animações & Família */}
        {data.animation && data.animation.length > 0 && (
          <CategoryRow
            title="Animações &amp; Família"
            items={data.animation}
            onSelect={onSelectItem}
            badgeType="dublado"
            viewAllHref="/filmes?genre=animation"
          />
        )}
      </div>

      {/* Rodapé Fixo Exclusivo do JackIn */}
      <footer className="pt-10 pb-8 border-t border-zinc-800/80 mt-16 text-zinc-400 text-xs space-y-8 bg-[#09090b]/80 backdrop-blur-md rounded-2xl p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-1">
              <span className="text-xl font-black tracking-tight text-[#E50914] uppercase">JACK</span>
              <span className="text-xl font-black tracking-tight text-white uppercase">IN</span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              <strong className="text-zinc-200">AVISO LEGAL:</strong> O JackIn opera como um agregador e indexador automatizado de mídias P2P. Nenhum arquivo de vídeo é hospedado em nossos servidores locais. Todos os conteúdos são fornecidos por terceiros via protocolo BitTorrent.
            </p>
          </div>

          <div className="space-y-2">
            <h5 className="font-extrabold text-white uppercase text-xs tracking-wider">Informações</h5>
            <ul className="space-y-2 text-xs text-zinc-400 font-medium">
              <li className="hover:text-red-500 cursor-pointer transition-colors">Sobre o JackIn</li>
              <li className="hover:text-red-500 cursor-pointer transition-colors">Suporte &amp; FAQ P2P</li>
              <li className="hover:text-red-500 cursor-pointer transition-colors">Política DMCA / Direitos</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h5 className="font-extrabold text-white uppercase text-xs tracking-wider">Gêneros em Alta</h5>
            <ul className="space-y-2 text-xs text-zinc-400 font-medium">
              <li className="hover:text-red-500 cursor-pointer transition-colors">Ficção Científica 4K</li>
              <li className="hover:text-red-500 cursor-pointer transition-colors">Ação e Aventura</li>
              <li className="hover:text-red-500 cursor-pointer transition-colors">Animação e Família</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-zinc-800/80 pt-6 text-[11px] text-zinc-500 gap-4">
          <p>© 2026 JackIn. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 font-medium">
            <span className="hover:text-zinc-300 cursor-pointer transition-colors">Política de Privacidade</span>
            <span>&middot;</span>
            <span className="hover:text-zinc-300 cursor-pointer transition-colors">Termos de Uso</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
