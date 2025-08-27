export const notificationRules = {
    milestones: [
      // First task completion
      {
        condition: (completedCount: number) => completedCount === 1,
        type: 'achievement',
        title: 'First Task Completed!',
        message: () => '🎯 Great start! Your productivity journey begins now!',
        actionType: 'acknowledge',
        actionTarget: '/tasks',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          lastTaskId: taskId,
          badge: 'first-task',
        }),
      },
      // Half century (50 tasks)
      {
        condition: (completedCount: number) => completedCount === 50,
        type: 'achievement',
        title: 'Half Century!',
        message: () => '🔥 50 tasks completed! You\'re on fire!',
        actionType: 'claim',
        actionTarget: '/rewards',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          badge: '50-tasks',
          lastTaskId: taskId,
        }),
      },
      // Century (100 tasks)
      {
        condition: (completedCount: number) => completedCount === 100,
        type: 'levelUp',
        title: 'Century!',
        message: () => '💯 Wow! 100 tasks completed! You\'re unstoppable!',
        actionType: 'acknowledge',
        actionTarget: '/profile/achievements',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          level: 'Pro',
          lastTaskId: taskId,
          badge: 'centurion',
        }),
      },
      // 250 tasks
      {
        condition: (completedCount: number) => completedCount === 250,
        type: 'achievement',
        title: 'Quarter K!',
        message: () => '🚀 250 tasks! You\'re a productivity machine!',
        actionType: 'acknowledge',
        actionTarget: '/profile/achievements',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          level: 'Elite',
          lastTaskId: taskId,
          badge: 'quarter-k',
        }),
      },
      // 500 tasks
      {
        condition: (completedCount: number) => completedCount === 500,
        type: 'achievement',
        title: '500 Tasks!',
        message: () => '🌟 Half a thousand tasks completed! Incredible dedication!',
        actionType: 'claim',
        actionTarget: '/rewards',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          level: 'Master',
          lastTaskId: taskId,
          badge: '500-club',
        }),
      },
      // 1000 tasks
      {
        condition: (completedCount: number) => completedCount === 1000,
        type: 'levelUp',
        title: 'Grand Master!',
        message: () => '🏆 1,000 TASKS COMPLETED! You\'ve reached Grand Master status!',
        actionType: 'acknowledge',
        actionTarget: '/profile/achievements',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          level: 'Grand Master',
          lastTaskId: taskId,
          badge: 'grand-master',
        }),
      },
       // Regular milestones (every 10 tasks)
       {
        condition: (completedCount: number) => completedCount > 0 && completedCount % 10 === 0,
        type: 'milestone',
        title: 'Milestone Achieved!',
        message: (count: number) => `🏆 You've completed ${count} tasks! Keep up the great work!`,
        actionType: 'acknowledge',
        actionTarget: '/achievements',
        metadata: (count: number, taskId: string) => ({
          completedCount: count,
          lastTaskId: taskId,
          milestone: Math.floor(count / 10) * 10,
        }),
      },
    ],
  };