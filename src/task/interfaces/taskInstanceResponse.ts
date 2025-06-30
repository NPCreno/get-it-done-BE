import { User } from "src/user/models/user.interface";

export interface TaskInstanceResponse {
    id: string;
    task_id: string;
    title: string;
    description: string | null;
    priority: "Low" | "Medium" | "High";
    status: "Pending" | "Complete" | "Overdue";
    due_date: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    user?: User;
    project_title?: string;
    user_id?: string;
}
