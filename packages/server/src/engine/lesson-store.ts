import type { Lesson } from "../types/learning-types.js";
import { LESSONS_PATH } from "../util/files.js";
import { readJsonSafe, writeJsonAtomic } from "../util/files.js";

export async function getLessons(): Promise<Lesson[]> {
  return readJsonSafe<Lesson[]>(LESSONS_PATH, []);
}

export async function addLesson(lesson: Omit<Lesson, "id" | "createdAt">): Promise<Lesson> {
  const lessons = await getLessons();
  const newLesson: Lesson = {
    ...lesson,
    id: `les-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };

  lessons.push(newLesson);

  // Keep max 100
  const trimmed = lessons.slice(-100);
  await writeJsonAtomic(LESSONS_PATH, trimmed);

  return newLesson;
}

export async function confirmLesson(lessonId: string): Promise<void> {
  const lessons = await getLessons();
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) return;

  lesson.confidence = Math.min(1, lesson.confidence + 0.1);
  lesson.lastConfirmed = Date.now();
  await writeJsonAtomic(LESSONS_PATH, lessons);
}

/**
 * Select top lessons by confidence, with recency boost.
 */
export function selectTopLessons(lessons: Lesson[], maxCount: number): Lesson[] {
  return lessons
    .sort((a, b) => {
      const recencyA = a.lastConfirmed ? Math.max(0, 1 - (Date.now() - a.lastConfirmed) / (14 * 24 * 60 * 60 * 1000)) : 0;
      const recencyB = b.lastConfirmed ? Math.max(0, 1 - (Date.now() - b.lastConfirmed) / (14 * 24 * 60 * 60 * 1000)) : 0;
      return (b.confidence + recencyB * 0.2) - (a.confidence + recencyA * 0.2);
    })
    .slice(0, maxCount);
}
