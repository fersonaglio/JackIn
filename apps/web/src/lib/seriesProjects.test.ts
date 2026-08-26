import { describe, expect, it } from 'vitest';
import type { Project } from './api';
import { breakdownSeries, seasonChips } from './seriesProjects';

function project(partial: Partial<Project> & { id: string }): Project {
  const { id, ...rest } = partial;
  return {
    id,
    youtubeUrl: '',
    title: null,
    status: 'done',
    errorMessage: null,
    createdAt: '',
    ...rest,
  };
}

describe('breakdownSeries', () => {
  it('temporadas em andamento: packs contam como unidades', () => {
    const projects = [
      project({ id: 't1', title: 'Show (T1)', status: 'downloading', seriesId: 's', seasonNumber: 1, progressPct: 29 }),
      project({ id: 't2', title: 'Show (T2)', status: 'downloading', seriesId: 's', seasonNumber: 2, progressPct: 48 }),
      project({ id: 't3', title: 'Show (T3)', status: 'downloading', seriesId: 's', seasonNumber: 3, progressPct: 5 }),
      project({ id: 't4', title: 'Show (T4)', status: 'downloading', seriesId: 's', seasonNumber: 4, progressPct: 36 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.baseTitle).toBe('Show');
    expect(b.hasEpisodes).toBe(false);
    expect(b.packs.length).toBe(4);
    expect(b.totalUnits).toBe(4);
    expect(b.doneUnits).toBe(0);
    expect(b.totalSeasons).toBe(4);
    expect(b.readySeasons).toBe(0);
    expect(b.allDone).toBe(false);
    expect(b.activeDownload?.id).toBe('t1');
    expect(b.currentPercent).toBe(29);
    expect(b.seasons.map((s) => s.percent)).toEqual([29, 48, 5, 36]);
  });

  it('episódios indexados: contam como unidades (packs viram linhas de temporada)', () => {
    const projects = [
      project({ id: 'pack', title: 'Show (T1)', status: 'done', seriesId: 's', seasonNumber: 1 }),
      project({ id: 'e1', title: 'Show S01E01', status: 'done', seriesId: 's', seasonNumber: 1, episodeNumber: 1, watched: 1 }),
      project({ id: 'e2', title: 'Show S01E02', status: 'done', seriesId: 's', seasonNumber: 1, episodeNumber: 2 }),
      project({ id: 'e3', title: 'Show S01E03', status: 'error', seriesId: 's', seasonNumber: 1, episodeNumber: 3 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.baseTitle).toBe('Show');
    expect(b.hasEpisodes).toBe(true);
    expect(b.episodes.length).toBe(3);
    expect(b.totalUnits).toBe(3);
    expect(b.doneUnits).toBe(2);
    expect(b.availableCount).toBe(3); // 2 eps done + 1 pack done
    expect(b.watchedCount).toBe(1);
    expect(b.allDone).toBe(false);
    expect(b.seasons.length).toBe(1);
    expect(b.seasons[0].pack?.id).toBe('pack');
    expect(b.seasons[0].ready).toBe(true); // pack done
    expect(b.seasons[0].percent).toBe(100);
  });

  it('temporada sem pack fica pronta quando todos os episódios estão done', () => {
    const projects = [
      project({ id: 'e1', title: 'Show S02E01', status: 'done', seriesId: 's', seasonNumber: 2, episodeNumber: 1 }),
      project({ id: 'e2', title: 'Show S02E02', status: 'done', seriesId: 's', seasonNumber: 2, episodeNumber: 2 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.seasons[0].ready).toBe(true);
    expect(b.readySeasons).toBe(1);
    expect(b.allDone).toBe(true);
    expect(b.currentPercent).toBe(100);
  });

  it('download ativo define a barra principal e speed', () => {
    const projects = [
      project({ id: 'done', title: 'Show (T1)', status: 'done', seriesId: 's', seasonNumber: 1, progressPct: 100 }),
      project({ id: 'live', title: 'Show (T2)', status: 'downloading', seriesId: 's', seasonNumber: 2, progressPct: 48 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.activeDownload?.id).toBe('live');
    expect(b.currentPercent).toBe(48);
    expect(b.readySeasons).toBe(1);
  });

  it('série vazia não explode', () => {
    const b = breakdownSeries([]);
    expect(b.baseTitle).toBe('Série');
    expect(b.totalUnits).toBe(0);
    expect(b.allDone).toBe(false);
  });

  it('pack 100% em preparação não trava a barra em 100 (nada pronto ainda)', () => {
    const projects = [
      project({ id: 'pack', title: 'Show (T1)', status: 'preparing', seriesId: 's', seasonNumber: 1, progressPct: 100 }),
      project({ id: 'e1', title: 'Show S01E01', status: 'preparing', seriesId: 's', seasonNumber: 1, episodeNumber: 1 }),
      project({ id: 'e2', title: 'Show S01E02', status: 'preparing', seriesId: 's', seasonNumber: 1, episodeNumber: 2 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.currentPercent).toBe(0); // transferência acabou, mas nada está pronto
    expect(b.activeDownload?.status).toBe('preparing');
    expect(b.anyPreparing).toBe(true);
    expect(b.readySeasons).toBe(0);
  });

  it('barra volta a subir conforme episódios ficam prontos', () => {
    const projects = [
      project({ id: 'e1', title: 'Show S01E01', status: 'done', seriesId: 's', seasonNumber: 1, episodeNumber: 1 }),
      project({ id: 'e2', title: 'Show S01E02', status: 'preparing', seriesId: 's', seasonNumber: 1, episodeNumber: 2 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.currentPercent).toBe(50);
  });

  it('calcula porcentagem assistida por episódio, temporada e série como um todo', () => {
    const projects = [
      // S1: 2 eps -> E1 assistido (100%), E2 no meio (1350s de 2700s = 50%) -> Temporada 1 = 75%
      project({ id: 'e1', title: 'Show S01E01', status: 'done', seriesId: 's', seasonNumber: 1, episodeNumber: 1, watched: 1 }),
      project({ id: 'e2', title: 'Show S01E02', status: 'done', seriesId: 's', seasonNumber: 1, episodeNumber: 2, watchProgress: 1350, watched: 0 }),
      // S2: 2 eps -> E1 não assistido (0%), E2 não assistido (0%) -> Temporada 2 = 0%
      project({ id: 'e3', title: 'Show S02E01', status: 'done', seriesId: 's', seasonNumber: 2, episodeNumber: 1, watched: 0 }),
      project({ id: 'e4', title: 'Show S02E02', status: 'done', seriesId: 's', seasonNumber: 2, episodeNumber: 2, watched: 0 }),
    ];
    const b = breakdownSeries(projects);
    expect(b.watchedCount).toBe(1);
    expect(b.seasons[0].watchPercent).toBe(75);
    expect(b.seasons[0].allWatched).toBe(false);
    expect(b.seasons[1].watchPercent).toBe(0);
    // Série total: (100 + 50 + 0 + 0) / 4 = 37.5 -> 38%
    expect(b.watchPercent).toBe(38);
    expect(b.allWatched).toBe(false);
  });
});

describe('seasonChips', () => {
  it('formata chips curtos por temporada', () => {
    const projects = [
      project({ id: 't1', status: 'downloading', seriesId: 's', seasonNumber: 1, progressPct: 29 }),
      project({ id: 't2', status: 'done', seriesId: 's', seasonNumber: 2, progressPct: 100 }),
    ];
    const { seasons } = breakdownSeries(projects);
    expect(seasonChips(seasons)).toBe('T1 29 · T2 ✓');
  });
});
