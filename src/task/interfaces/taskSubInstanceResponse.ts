export interface TaskSubInstanceResponse {
    id: string;
    taskSubInstance_id: string;
    title: string;
    status: "Pending" | "Complete" | "Overdue";
    due_date: Date | null;
    createdAt: Date;
    updatedAt: Date;
}