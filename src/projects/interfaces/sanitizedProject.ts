export interface SanitizedProject {
id: number;
project_id: string;
title: string;
description: string;
color: string;
colorLabel: string;
due_date: Date;
createdAt: Date;
updatedAt: Date;
deletedAt: Date;
user_id: string;
task_count: number;
}